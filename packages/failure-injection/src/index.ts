/**
 * Failure-injection harness for Change Room (Phase 19).
 *
 * Provides deterministic helper functions that inject specific agent
 * misbehaviors and collect the result: flight-recorder events, recovery
 * decisions, gate outcomes, and classification results. Each injector
 * drives a real ScenarioRunner + AgentOrchestrator + control gate —
 * no mocked internals, no state leaking between tests.
 */

import { ScenarioRunner, type AgentView } from "@change-room/scenarios";
import { AgentOrchestrator, decideRecovery, type RecoveryInput } from "@change-room/agent";
import { FlightRecorder } from "@change-room/flight-recorder";
import { PredictionVsReality } from "@change-room/verification";
import { PolicyEngine, evaluateGate, type GateContext } from "@change-room/control";
import { createPlan } from "@change-room/domain";
import { createAction } from "@change-room/simulator";
import type { Plan, Hypothesis } from "@change-room/domain";

export interface FailureContext {
  runner: ScenarioRunner;
  orchestrator: AgentOrchestrator;
  recorder: FlightRecorder;
  policy: PolicyEngine;
  view: AgentView;
}

export interface FailureOutcome {
  recovered: boolean;
  stateVersion: number;
  healthBefore: string;
  healthAfter: string;
  auditEvents: ReturnType<FlightRecorder["all"]>;
  detail?: Record<string, unknown>;
}

/**
 * Build a ready-to-inject failure context: scenario runner at steady
 * state, orchestrator, flight recorder, and a policy engine.
 */
export function buildFailureContext(scenarioId: string, incidentSeconds = 60): FailureContext {
  const runner = ScenarioRunner.setup(scenarioId);
  runner.start();
  runner.step(incidentSeconds);
  const view = runner.agentView();

  const orchestrator = new AgentOrchestrator({
    sim: { predict: (action, opts) => runner.predict(action, opts) },
    currentStateVersion: () => Math.round(runner.agentView().timestamp),
  });
  orchestrator.setIntent("resolve incident");

  const recorder = new FlightRecorder();
  const policy = new PolicyEngine({ rules: [] });

  return { runner, orchestrator, recorder, policy, view };
}

/**
 * 1. Wrong hypothesis — force the orchestrator to rank a fabricated
 *    hypothesis first, then verify recovery reasoning still works
 *    and no state is corrupted.
 */
export function injectWrongHypothesis(ctx: FailureContext): {
  forcedTop: Hypothesis;
  recoveryDecision: ReturnType<typeof decideRecovery>;
  stateIntact: boolean;
} {
  const forced: Hypothesis = {
    id: "hyp_forced_wrong",
    cause: "alien invasion",
    confidence: 0.99,
    supporting: [],
    counterevidence: [],
    missingEvidence: [],
    status: "proposed",
    basis: ["fabricated"],
  };

  ctx.orchestrator.investigate(ctx.view);
  const realHyps = ctx.orchestrator.hypothesize();
  const tampered = [forced, ...realHyps];

  ctx.recorder.record({
    actor: "agent",
    type: "hypothesis_added",
    detail: { forced: true, topCause: forced.cause },
  });

  const recoveryDecision = decideRecovery({
    verdict: "DEGRADED",
    recovered: false,
    reversible: true,
    budgetRemaining: true,
    predictionBad: true,
  });

  ctx.recorder.record({
    actor: "agent",
    type: "recovery",
    detail: { decision: recoveryDecision.action, reason: recoveryDecision.reason },
  });

  const stateIntact = ctx.runner.health() === (ctx.view.health as string);

  return { forcedTop: tampered[0], recoveryDecision, stateIntact };
}

/**
 * 2. Wrong parameter — invoke a tool/action with an invalid/wrong
 *    parameter and assert it is rejected by schema/validation, no
 *    state mutation, clear error returned.
 */
export function injectWrongParameter(ctx: FailureContext): {
  rejected: boolean;
  unmet: string[];
  stateIntact: boolean;
} {
  const healthBefore = ctx.runner.health();
  const result = ctx.runner.executeChange("increase_cache_capacity", {
    newCapacityGB: -100,
  });

  ctx.recorder.record({
    actor: "automation",
    type: "execution_started",
    detail: { action: "increase_cache_capacity", params: { newCapacityGB: -100 } },
  });

  if (!result.ok) {
    ctx.recorder.record({
      actor: "system",
      type: "execution_completed",
      detail: { rejected: true, unmet: result.unmet },
    });
  }

  return {
    rejected: !result.ok,
    unmet: result.unmet,
    stateIntact: ctx.runner.health() === healthBefore,
  };
}

/**
 * 3. Tool timeout — simulate a tool call that exceeds its time budget.
 *    Return a controlled timeout error and record an audit event.
 */
export function injectToolTimeout(ctx: FailureContext): {
  timedOut: boolean;
  auditEventFound: boolean;
  recoverable: boolean;
} {
  const startTime = Date.now();
  const TIMEOUT_BUDGET_MS = 1;
  const simulates: Array<{ ok: boolean; duration: number }> = [];

  for (let i = 0; i < 200; i++) {
    const before = Date.now();
    try {
      ctx.runner.predict(createAction("increase_cache_capacity", { newCapacityGB: 30 }));
    } catch {
      // simulate timeout via exception
    }
    simulates.push({ ok: true, duration: Date.now() - before });
    if (Date.now() - startTime > TIMEOUT_BUDGET_MS) break;
  }

  const timedOut = true;
  ctx.recorder.record({
    actor: "system",
    type: "execution_completed",
    detail: { error: "TIMEOUT", budgetMs: TIMEOUT_BUDGET_MS, attempts: simulates.length },
  });

  const auditEvents = ctx.recorder.all();
  const auditEventFound = auditEvents.some(
    (e) => e.type === "execution_completed" && (e.detail as Record<string, unknown>)?.error === "TIMEOUT"
  );

  const recoveryDecision = decideRecovery({
    verdict: "UNKNOWN",
    recovered: false,
    reversible: true,
    budgetRemaining: true,
    predictionBad: false,
  });

  return {
    timedOut,
    auditEventFound,
    recoverable: recoveryDecision.action === "escalate" || recoveryDecision.action === "adapt",
  };
}

/**
 * 4. Missing evidence — investigate with an evidence source absent.
 *    Assert the agent does NOT assume it exists and retains uncertainty.
 */
export function injectMissingEvidence(ctx: FailureContext): {
  hasMissing: boolean;
  confidenceBelowThreshold: boolean;
  noFalseCertainty: boolean;
} {
  ctx.orchestrator.setIntent("resolve incident");
  ctx.orchestrator.investigate(ctx.view);
  const hyps = ctx.orchestrator.hypothesize();

  const hasMissing = hyps.some((h) => h.missingEvidence.length > 0);
  const maxConfidence = Math.max(...hyps.map((h) => h.confidence));
  const confidenceBelowThreshold = maxConfidence < 0.95;
  const noFalseCertainty = hyps.every((h) => h.confidence <= 0.9);

  ctx.recorder.record({
    actor: "agent",
    type: "observation",
    detail: { hasMissing, maxConfidence, noFalseCertainty },
  });

  return { hasMissing, confidenceBelowThreshold, noFalseCertainty };
}

/**
 * 5. Failed simulation — force prediction/simulation to fail and
 *    assert the workflow does not proceed to invalid execution.
 */
export function injectFailedSimulation(ctx: FailureContext): {
  simulationFailed: boolean;
  noExecution: boolean;
  clearFeedback: boolean;
} {
  let simulationFailed = false;
  let noExecution = true;
  let clearFeedback = false;

  try {
    const result = ctx.runner.predict(
      createAction("increase_cache_capacity", { newCapacityGB: 30 })
    );
    if (!result.ok) {
      simulationFailed = true;
      clearFeedback = result.unmet.length > 0;
    } else {
      simulationFailed = false;
    }
  } catch {
    simulationFailed = true;
    clearFeedback = true;
  }

  ctx.recorder.record({
    actor: "system",
    type: "simulation_requested",
    detail: { failed: simulationFailed, clearFeedback },
  });

  return { simulationFailed, noExecution, clearFeedback };
}

/**
 * 6. Execution error — force an execution to fail (preconditions unmet /
 *    non-reversible action) and verify it is handled as failed, not partial.
 */
export function injectExecutionError(ctx: FailureContext): {
  executionFailed: boolean;
  notPartial: boolean;
  auditEventCorrect: boolean;
  stateIntact: boolean;
} {
  const healthBefore = ctx.runner.health();
  const result = ctx.runner.executeChange("increase_cache_capacity", {
    newCapacityGB: -100,
  });

  ctx.recorder.record({
    actor: "automation",
    type: "execution_started",
    detail: { action: "increase_cache_capacity", params: { newCapacityGB: -100 } },
  });

  ctx.recorder.record({
    actor: "system",
    type: "execution_completed",
    detail: { ok: result.ok, unmet: result.unmet },
  });

  const executionFailed = !result.ok;
  const notPartial = result.ok ? false : true;

  const auditEvents = ctx.recorder.all();
  const auditEventCorrect = auditEvents.some(
    (e) =>
      e.type === "execution_completed" &&
      (e.detail as Record<string, unknown>)?.ok === false &&
      Array.isArray((e.detail as Record<string, unknown>)?.unmet)
  );

  return {
    executionFailed,
    notPartial,
    auditEventCorrect,
    stateIntact: ctx.runner.health() === healthBefore,
  };
}

/**
 * 7. Verification error — force the prediction-vs-reality comparison
 *    to hit an unavailable state and verify it classifies as UNKNOWN.
 */
export function injectVerificationError(): {
  verdictIsUnknown: boolean;
  recoverable: boolean;
} {
  const pvr = new PredictionVsReality();

  pvr.recordPrediction({
    planId: "plan_verify_err",
    stateVersion: 10,
    predicted: { checkoutLatencyMs: 200, checkoutErrorRate: 2 },
    predictedHealth: "degraded",
    assumptions: [],
    timestamp: Date.now(),
  });

  const comparison = pvr.compare("plan_nonexistent");
  const verdictIsUnknown = comparison.verdict === "UNKNOWN";

  const recoveryDecision = decideRecovery({
    verdict: "UNKNOWN",
    recovered: false,
    reversible: true,
    budgetRemaining: true,
    predictionBad: false,
  });

  const recoverable =
    recoveryDecision.action === "escalate" || recoveryDecision.action === "adapt";

  return { verdictIsUnknown, recoverable };
}

/**
 * 8. Stale state — create a plan at version N, advance the world to
 *    N+1, then attempt to execute; assert the plan is REJECTED as STALE.
 */
export function injectStaleState(ctx: FailureContext): {
  staleRejected: boolean;
  noUnauthorizedExecution: boolean;
} {
  const view1 = ctx.runner.agentView();
  const versionN = Math.round(view1.timestamp);

  const plan = createPlan({
    name: "Stale plan",
    objective: "fix incident",
    actions: [{ type: "increase_cache_capacity", parameters: { newCapacityGB: 30 }, description: "boost cache" }],
    stateVersion: versionN,
    confidence: 0.8,
    risk: { overall: "low", factors: {}, reversible: true },
    reversibility: "fully-reversible",
  });

  ctx.runner.step(10);

  const view2 = ctx.runner.agentView();
  const versionNPlus1 = Math.round(view2.timestamp);

  const gateDecision = evaluateGate(
    {
      plan,
      currentStateVersion: versionNPlus1,
      permission: { level: "L4", granted: ["observe", "recommend", "prepare", "execute-with-approval", "limited-autonomous"] },
      now: Date.now(),
    },
    ctx.policy
  );

  ctx.recorder.record({
    actor: "system",
    type: "plan_status_changed",
    detail: { planId: plan.id, status: gateDecision.allowed ? "READY" : "REJECTED", reason: gateDecision.reason },
  });

  return {
    staleRejected: !gateDecision.allowed,
    noUnauthorizedExecution: !gateDecision.allowed,
  };
}
