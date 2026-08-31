import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildFailureContext,
  injectWrongHypothesis,
  injectWrongParameter,
  injectToolTimeout,
  injectMissingEvidence,
  injectFailedSimulation,
  injectExecutionError,
  injectVerificationError,
  injectStaleState,
} from "../dist/index.js";

import { decideRecovery } from "@change-room/agent";
import { FlightRecorder } from "@change-room/flight-recorder";
import { PredictionVsReality } from "@change-room/verification";
import { PolicyEngine, evaluateGate } from "@change-room/control";
import { createPlan } from "@change-room/domain";
import { createAction } from "@change-room/simulator";
import { ScenarioRunner, runBlindSession } from "@change-room/scenarios";

const SCENARIO = "cache-failure";

// ---------------------------------------------------------------------------
// 1. Wrong hypothesis - fabricated top hypothesis does not corrupt state
// ---------------------------------------------------------------------------
test("1 - wrong hypothesis: fabricated top cause does not corrupt state and recovery reasoning works", () => {
  const ctx = buildFailureContext(SCENARIO);
  const result = injectWrongHypothesis(ctx);

  assert.equal(result.forcedTop.cause, "alien invasion", "forced hypothesis is the fabricated one");
  assert.equal(result.stateIntact, true, "no state corruption from wrong hypothesis");
  assert.ok(
    result.recoveryDecision.action === "adapt" || result.recoveryDecision.action === "escalate" || result.recoveryDecision.action === "rollback",
    "recovery reasoning produces a valid action for a degraded + bad prediction"
  );

  const auditEvents = ctx.recorder.all();
  assert.ok(auditEvents.length >= 1, "flight recorder captured the wrong-hypothesis event");
  const hypEvent = auditEvents.find((e) => e.type === "hypothesis_added" && e.detail && e.detail.forced === true);
  assert.ok(hypEvent, "audit event records the forced hypothesis");

  const healthBefore = ctx.runner.health();
  ctx.runner.step(5);
  assert.equal(ctx.runner.health(), healthBefore, "world unchanged after hypothesis injection");
});

// ---------------------------------------------------------------------------
// 2. Wrong parameter - invalid parameter rejected, no state mutation
// ---------------------------------------------------------------------------
test("2 - wrong parameter: invalid value rejected by precondition, no state mutation", () => {
  const ctx = buildFailureContext(SCENARIO);
  const result = injectWrongParameter(ctx);

  assert.equal(result.rejected, true, "negative capacity is rejected");
  assert.ok(result.unmet.length > 0, "unmet preconditions are reported");
  assert.equal(result.stateIntact, true, "world health unchanged after rejected execution");
});

// ---------------------------------------------------------------------------
// 3. Tool timeout - controlled timeout, audit event, recoverable workflow
// ---------------------------------------------------------------------------
test("3 - tool timeout: controlled error, audit event recorded, workflow remains recoverable", () => {
  const ctx = buildFailureContext(SCENARIO);
  const result = injectToolTimeout(ctx);

  assert.equal(result.timedOut, true, "timeout was triggered");
  assert.equal(result.auditEventFound, true, "flight recorder captured TIMEOUT audit event");
  assert.equal(result.recoverable, true, "workflow is recoverable after timeout");
});

// ---------------------------------------------------------------------------
// 4. Missing evidence - agent retains uncertainty, no false certainty
// ---------------------------------------------------------------------------
test("4 - missing evidence: agent retains uncertainty and does not assume absent sources exist", () => {
  const ctx = buildFailureContext(SCENARIO);
  const result = injectMissingEvidence(ctx);

  assert.equal(result.hasMissing, true, "at least one hypothesis has missing evidence");
  assert.equal(result.confidenceBelowThreshold, true, "no hypothesis reaches certainty (0.95)");
  assert.equal(result.noFalseCertainty, true, "all confidence values <= 0.9 (no fabricated certainty)");
});

// ---------------------------------------------------------------------------
// 5. Failed simulation - does not proceed to invalid execution
// ---------------------------------------------------------------------------
test("5 - failed simulation: workflow does not proceed to invalid execution", () => {
  const ctx = buildFailureContext(SCENARIO);
  const result = injectFailedSimulation(ctx);

  assert.equal(result.noExecution, true, "no execution was attempted after simulation failure");
  assert.equal(typeof result.clearFeedback === "boolean", true, "feedback flag is present");

  const auditEvents = ctx.recorder.all();
  const simEvent = auditEvents.find((e) => e.type === "simulation_requested");
  assert.ok(simEvent, "audit event records simulation attempt");
});

// ---------------------------------------------------------------------------
// 6. Execution error - handled as failed (not partial), audit event correct
// ---------------------------------------------------------------------------
test("6 - execution error: failed execution, no state corruption, correct audit event", () => {
  const ctx = buildFailureContext(SCENARIO);
  const result = injectExecutionError(ctx);

  assert.equal(result.executionFailed, true, "execution failed due to invalid precondition");
  assert.equal(result.notPartial, true, "failure is classified as failed, not partial");
  assert.equal(result.auditEventCorrect, true, "audit event records execution_completed with ok=false");
  assert.equal(result.stateIntact, true, "no corrupted state after execution error");
});

// ---------------------------------------------------------------------------
// 7. Verification error - UNKNOWN verdict, workflow recoverable
// ---------------------------------------------------------------------------
test("7 - verification error: classifies as UNKNOWN when data is missing, workflow recoverable", () => {
  const result = injectVerificationError();

  assert.equal(result.verdictIsUnknown, true, "missing data yields UNKNOWN verdict");
  assert.equal(result.recoverable, true, "UNKNOWN verdict produces a recoverable decision (escalate/adapt)");
});

// ---------------------------------------------------------------------------
// 8. Stale state - plan rejected, no unauthorized execution
// ---------------------------------------------------------------------------
test("8 - stale state: plan bound to old version is rejected by control gate", () => {
  const ctx = buildFailureContext(SCENARIO);
  const result = injectStaleState(ctx);

  assert.equal(result.staleRejected, true, "stale plan is rejected by the gate");
  assert.equal(result.noUnauthorizedExecution, true, "no execution occurs for a stale plan");

  const auditEvents = ctx.recorder.all();
  const staleEvent = auditEvents.find(
    (e) => e.type === "plan_status_changed" && e.detail && e.detail.status === "REJECTED"
  );
  assert.ok(staleEvent, "audit event records plan rejection");
});

// ---------------------------------------------------------------------------
// Cross-cutting: no ground truth leaks through any failure injection
// ---------------------------------------------------------------------------
test("no ground truth leaks through any failure injection path", () => {
  const ctx = buildFailureContext(SCENARIO);

  injectWrongHypothesis(ctx);
  injectWrongParameter(ctx);
  injectToolTimeout(ctx);
  injectMissingEvidence(ctx);
  injectFailedSimulation(ctx);
  injectExecutionError(ctx);
  injectStaleState(ctx);

  const allEvents = ctx.recorder.all();
  const blob = JSON.stringify(allEvents);
  assert.ok(!blob.includes("seed"), "flight recorder must not contain seed");
  assert.ok(!blob.includes("disturbances"), "flight recorder must not contain disturbances");
  assert.ok(!blob.includes("cache-failure"), "flight recorder must not contain scenario id");
});

// ---------------------------------------------------------------------------
// Cross-cutting: decideRecovery is consistent for each injected verdict
// ---------------------------------------------------------------------------
test("decideRecovery produces safe decisions for every injected failure verdict", () => {
  const cases = [
    { verdict: "HEALTHY", recovered: true, label: "wrong-hypothesis recovery" },
    { verdict: "UNKNOWN", recovered: false, label: "tool-timeout recovery" },
    { verdict: "UNKNOWN", recovered: false, label: "verification-error recovery" },
    { verdict: "DEGRADED", recovered: false, label: "execution-error recovery" },
    { verdict: "REGRESSION", recovered: false, label: "failed-simulation recovery" },
  ];

  for (const c of cases) {
    const decision = decideRecovery({
      verdict: c.verdict,
      recovered: c.recovered,
      reversible: true,
      budgetRemaining: true,
      predictionBad: c.verdict === "REGRESSION",
    });
    assert.ok(
      ["continue", "adapt", "escalate", "rollback", "stop"].includes(decision.action),
      `${c.label}: recovery action must be a valid decision (got ${decision.action})`
    );
    assert.ok(typeof decision.reason === "string" && decision.reason.length > 0, `${c.label}: reason must be non-empty`);
  }
});

// ---------------------------------------------------------------------------
// Cross-cutting: all 8 injections produce flight-recorder events
// ---------------------------------------------------------------------------
test("every failure mode produces at least one flight-recorder audit event", () => {
  const ctx = buildFailureContext(SCENARIO);

  injectWrongHypothesis(ctx);
  injectWrongParameter(ctx);
  injectToolTimeout(ctx);
  injectMissingEvidence(ctx);
  injectFailedSimulation(ctx);
  injectExecutionError(ctx);
  injectStaleState(ctx);

  const events = ctx.recorder.all();
  assert.ok(events.length >= 8, `at least 8 audit events recorded (got ${events.length})`);

  const types = new Set(events.map((e) => e.type));
  assert.ok(types.has("hypothesis_added"), "event types include hypothesis_added");
  assert.ok(types.has("execution_started"), "event types include execution_started");
  assert.ok(types.has("execution_completed"), "event types include execution_completed");
  assert.ok(types.has("observation"), "event types include observation");
  assert.ok(types.has("simulation_requested"), "event types include simulation_requested");
  assert.ok(types.has("plan_status_changed"), "event types include plan_status_changed");
});

// ---------------------------------------------------------------------------
// Cross-cutting: stale-plan detection works end-to-end through the gate
// ---------------------------------------------------------------------------
test("stale-plan: evaluateGate rejects when stateVersion lags", () => {
  const policy = new PolicyEngine({ rules: [] });
  const plan = createPlan({
    name: "Test plan",
    objective: "fix",
    actions: [{ type: "increase_cache_capacity", description: "boost cache" }],
    stateVersion: 5,
    confidence: 0.8,
    risk: { overall: "low", factors: {}, reversible: true },
  });

  const fresh = evaluateGate(
    { plan, currentStateVersion: 5, permission: { level: "L4", granted: ["observe", "recommend", "prepare", "execute-with-approval", "limited-autonomous"] }, now: Date.now() },
    policy
  );
  assert.equal(fresh.allowed, true, "fresh plan passes gate");

  const stale = evaluateGate(
    { plan, currentStateVersion: 10, permission: { level: "L4", granted: ["observe", "recommend", "prepare", "execute-with-approval", "limited-autonomous"] }, now: Date.now() },
    policy
  );
  assert.equal(stale.allowed, false, "stale plan is rejected");
  assert.equal(stale.stage, "freshness", "rejection stage is freshness");
});

// ---------------------------------------------------------------------------
// Cross-cutting: PredictionVsReality returns UNKNOWN for missing data
// ---------------------------------------------------------------------------
test("PredictionVsReality returns UNKNOWN verdict when prediction or actual is missing", () => {
  const pvr = new PredictionVsReality();

  pvr.recordPrediction({
    planId: "p_missing_actual",
    stateVersion: 1,
    predicted: { checkoutLatencyMs: 200, checkoutErrorRate: 2 },
    predictedHealth: "degraded",
    assumptions: [],
    timestamp: Date.now(),
  });

  const noActual = pvr.compare("p_missing_actual");
  assert.equal(noActual.verdict, "UNKNOWN", "missing actual yields UNKNOWN");
  assert.equal(noActual.reason, "NO_ACTUAL", "reason is NO_ACTUAL");

  const noPrediction = pvr.compare("p_nonexistent");
  assert.equal(noPrediction.verdict, "UNKNOWN", "missing prediction yields UNKNOWN");
  assert.equal(noPrediction.reason, "NO_PREDICTION", "reason is NO_PREDICTION");
});

// ---------------------------------------------------------------------------
// Cross-cutting: wrong parameter does not change tuning
// ---------------------------------------------------------------------------
test("wrong parameter: base tuning is unchanged after rejected execution", () => {
  const ctx = buildFailureContext(SCENARIO);
  const tuningBefore = JSON.parse(JSON.stringify(ctx.runner["sim"].baseTuning));

  ctx.runner.executeChange("increase_cache_capacity", { newCapacityGB: -50 });

  const tuningAfter = JSON.parse(JSON.stringify(ctx.runner["sim"].baseTuning));
  assert.deepEqual(tuningBefore, tuningAfter, "tuning must be identical after a rejected execution");
});

// ---------------------------------------------------------------------------
// Cross-cutting: execution error does not change tuning
// ---------------------------------------------------------------------------
test("execution error: base tuning unchanged after failed execution", () => {
  const ctx = buildFailureContext(SCENARIO);
  const tuningBefore = JSON.parse(JSON.stringify(ctx.runner["sim"].baseTuning));

  ctx.runner.executeChange("increase_cache_capacity", { newCapacityGB: -100 });

  const tuningAfter = JSON.parse(JSON.stringify(ctx.runner["sim"].baseTuning));
  assert.deepEqual(tuningBefore, tuningAfter, "tuning must be identical after a rejected execution");
});

// ---------------------------------------------------------------------------
// Cross-cutting: decideRecovery classifies all injected verification outcomes
// ---------------------------------------------------------------------------
test("recovery reasoning: decideRecovery classifies all injected verification outcomes correctly", () => {
  const scenarios = [
    { verdict: "HEALTHY", recovered: true, expected: "continue" },
    { verdict: "DEGRADED", recovered: false, expected: "adapt" },
    { verdict: "REGRESSION", recovered: false, expected: "rollback" },
    { verdict: "UNKNOWN", recovered: false, expected: "escalate" },
  ];

  for (const s of scenarios) {
    const decision = decideRecovery({
      verdict: s.verdict,
      recovered: s.recovered,
      reversible: true,
      budgetRemaining: true,
      predictionBad: s.verdict === "REGRESSION",
    });
    assert.equal(decision.action, s.expected, `${s.verdict}: must classify as ${s.expected}`);
  }
});

// ---------------------------------------------------------------------------
// Cross-cutting: flight-recorder events carry seq + timestamp
// ---------------------------------------------------------------------------
test("flight-recorder events all carry monotonic seq and timestamp", () => {
  const rec = new FlightRecorder();
  for (let i = 0; i < 10; i++) {
    rec.record({ actor: "system", type: "observation", detail: { i } });
  }
  const events = rec.all();
  assert.equal(events.length, 10);
  for (let i = 0; i < events.length; i++) {
    assert.equal(events[i].seq, i + 1, `event ${i} has correct seq`);
    assert.ok(events[i].timestamp > 0, `event ${i} has positive timestamp`);
  }
  assert.equal(events[0].seq < events[1].seq, true, "seq is monotonically increasing");
});

// ---------------------------------------------------------------------------
// Cross-cutting: blind-run still works after all injections
// ---------------------------------------------------------------------------
test("blind-run evaluation is unaffected by a prior failure-injection session", () => {
  const run = runBlindSession({ scenarioId: "cache-failure", incidentSeconds: 120 });
  assert.equal(run.metrics.diagnosisAccuracy.value, 1, "diagnosis accuracy unchanged");
  assert.equal(run.metrics.finalSystemHealth.value, "healthy", "final health still healthy");
});
