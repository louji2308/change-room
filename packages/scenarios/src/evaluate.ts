/**
 * Phase 16 — blind scenario evaluation harness (core, dependency-free).
 *
 * Runs any registered scenario "blind": the = operator = only ever sees the
 * agent-facing `AgentView` (or a deterministic heuristic over it) and may
 * propose remediation actions. The harness executes those actions on the live
 * execution world, lets the causal model reflect them, and reports the full
 * Phase-16 metric set as a structured object.
 *
 * Nothing here depends on the agent/control packages — it is pure Node over the
 * simulator so `@change-room/scenarios` stays runtime-light. The richer
 * agent-driven evaluation (real `AgentOrchestrator` + control-layer policy
 * checks) plugs the same harness via `operatorFactory`/`policyCheck` from the
 * `@change-room/evaluation` package.
 */

import type {
  ActionType,
  BusinessKpis,
  Disturbance,
  WorldTuning,
  PredictionResult,
} from "@change-room/simulator";
import { createAction } from "@change-room/simulator";
import { ScenarioRunner } from "./engine.js";
import { getScenario, rootCausesOf, type CauseLabel } from "./registry.js";
import type { AgentView, GroundTruth, ScenarioSession } from "./types.js";

export type MetricStatus = "computed" | "collected-but-not-yet-valued";
export type Health = "healthy" | "degraded" | "down";

export interface Metric<T> {
  value: T;
  status: MetricStatus;
  detail?: string[];
}

export interface OperatorAction {
  type: ActionType;
  parameters?: Record<string, number | string>;
}

export interface OperatorDecision {
  /** Remediation the operator proposes next (absent = take no further action). */
  action?: OperatorAction;
  /** Best-guess cause label (used for diagnosis accuracy). */
  cause?: string;
  /** Operator stops proposing actions. */
  stop?: boolean;
  /** Operator escalates the situation to a human. */
  escalate?: boolean;
  reason?: string;
  /** Operator may attach reasoning artifacts here (agent hypotheses, plans). */
  trace?: Record<string, unknown>;
}

export type BlindOperator = (view: AgentView, ctx: { attempt: number }) => OperatorDecision;

export interface PolicyVerdict {
  allowed: boolean;
  reason: string;
}

export interface RunOptions {
  scenarioId: string;
  /** Seconds the incident is allowed to mature before the operator starts. */
  incidentSeconds?: number;
  /** Seconds settled after each executed action before re-observing. */
  settleAfterAction?: number;
  /** Max operator actions before the run is considered unrecovered. */
  maxActions?: number;
  /** Simulated prediction horizon for the prediction-accuracy metric. */
  predictHorizon?: number;
  operator?: BlindOperator;
  /** Build the operator once the runner is alive (agent adapter needs it). */
  operatorFactory?: (runner: ScenarioRunner) => BlindOperator;
  /** Optional control-layer-like policy check; when provided, violations count. */
  policyCheck?: (type: ActionType, params: Record<string, number | string>, stateVersion: number) => PolicyVerdict | null;
  /** Also make one deliberately invalid tool call to prove rejection is counted. */
  probeInvalidCall?: boolean;
}

export interface OperatorCall {
  attempt: number;
  type: string;
  parameters: Record<string, number | string>;
  gateVerdict: PolicyVerdict | null;
  executed: boolean;
  unmet?: string[];
}

export interface EvaluationMetrics {
  /** 1.0 = top cause is the root cause; 0.75 = another true cause; 0 = wrong. */
  diagnosisAccuracy: Metric<number | null>;
  /** Blend of final health + checkout error reduction, in [0,1]. */
  planEffectiveness: Metric<number | null>;
  /** Fraction of executed actions that matched the scenario's expected recovery. */
  toolSelection: Metric<{ score: number | null; used: string[]; expected: string[] }>;
  /** Tool calls rejected by preconditions / policy / the gate. */
  invalidCalls: Metric<{ count: number; attempts: string[] }>;
  /** Sim-seconds from first observation until the system returns to healthy. */
  timeToRecovery: Metric<number | null>;
  /** Executed actions that were not part of the scenario's expected recovery. */
  unnecessaryActions: Metric<{ count: number; detail: string[] }>;
  /** Declared risk of the executed remediation (from the action contracts). */
  risk: Metric<{ overall: "low" | "medium" | "high" | null; perAction: string[] }>;
  /** Actions the policy layer forbade. */
  policyViolations: Metric<{ count: number | null; detail: string[] }>;
  /** Times the operator escalated to a human. */
  humanInterventions: Metric<{ count: number; detail: string[] }>;
  /** 1 - normalized |predicted − actual| over executed actions, in [0,1]. */
  predictionAccuracy: Metric<number | null>;
  /** Whether a rollback probe faithfully reverted the last executed change. */
  rollbackSuccess: Metric<boolean | null>;
  /** System health at the end of the operator's run (before the rollback probe). */
  finalSystemHealth: Metric<Health | null>;
}

export interface BlindRun {
  scenarioId: string;
  session: ScenarioSession;
  healthSequence: Health[];
  expectedCauses: CauseLabel[];
  metrics: EvaluationMetrics;
  groundTruth: GroundTruth;
  trace: {
    operatorCalls: OperatorCall[];
    timeline: Array<{ t: number; event: string; detail?: unknown }>;
  };
}

const HEALTH_OK: Record<Health, boolean> = { healthy: true, degraded: false, down: false };

function metric<T>(value: T, status: MetricStatus, detail?: string[]): Metric<T> {
  return { value, status, detail };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function byComponent(view: AgentView): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const m of view.metrics) out[String(m.componentId)] = m;
  return out;
}

/**
 * The built-in deterministic blind operator. A pure decision table over the
 * observable surface (only KPIs + metrics an operator could read). It proposes
 * one remediation at a time and re-observes after each, so compound and cascade
 * scenarios are resolved step by step. It never sees ground truth.
 */
export function defaultBlindOperator(view: AgentView): OperatorDecision {
  const k = view.kpis;
  const m = byComponent(view);
  const cache = m.cache;
  const db = m.database;
  const gateway = m["api-gateway"];
  const queue = m.queue;

  const cacheUtil = Number(cache?.utilization ?? 0);
  const cacheDegraded = cache?.degraded === true;
  // Capacity-bound cache collapse, not eviction-under-load: require the cache
  // to actually be running at a material utilization (a traffic spike empties
  // the hit-rate estimate too, but the cache itself idles at a few percent).
  if (cacheDegraded && cacheUtil >= 60 && k.cacheHitRateEstimate < 70) {
    return {
      cause: "cache degradation",
      action: { type: "increase_cache_capacity", parameters: { newCapacityGB: 30 } },
      reason: "cache collapsed and cache hit rate is low",
    };
  }

  // Traffic before database: elevated throughput is the least ambiguous load
  // signal, and a saturated database is often *secondary* spillover from a
  // surge (or from a cache/Miss). Resolve the cause with the strongest single
  // indicator first, then target component saturation.
  if (k.ordersThroughputPerSec > 400 || Number(gateway?.utilization ?? 0) > 85) {
    return {
      cause: "traffic anomaly",
      action: { type: "scale_service", parameters: { service: "checkout", factor: 1.5 } },
      reason: "throughput is elevated beyond expected baseline",
    };
  }

  if (db?.degraded === true || Number(db?.utilization ?? 0) > 90) {
    return {
      cause: "database saturation",
      action: { type: "scale_database", parameters: { factor: 1.5 } },
      reason: "database is saturated",
    };
  }

  if (Number(gateway?.errorRate ?? 0) > 5) {
    return {
      cause: "bad deployment",
      action: { type: "rollback_deployment" },
      reason: "gateway is failing — looks like a deployment",
    };
  }

  if (queue?.degraded === true || Number(queue?.queueDepth ?? 0) > 50) {
    return {
      cause: "queue backlog",
      action: { type: "scale_service", parameters: { service: "queue", factor: 1.5 } },
      reason: "background queue is backing up",
    };
  }

  if (Number(db?.utilization ?? 0) > 75) {
    return {
      cause: "configuration regression",
      action: { type: "restore_configuration" },
      reason: "no single obvious fault; database pressured by drift",
    };
  }

  return { stop: true, reason: "no actionable signal" };
}

/**
 * Run a scenario blind end to end and collect the Phase-16 metric set.
 * Deterministic: same scenario + options ⇒ identical metrics.
 */
export function runBlindSession(opts: RunOptions): BlindRun {
  const def = getScenario(opts.scenarioId);
  if (!def) throw new Error(`unknown scenario: ${opts.scenarioId}`);

  const incidentSeconds = opts.incidentSeconds ?? 45;
  const settleAfterAction = opts.settleAfterAction ?? 10;
  const maxActions = opts.maxActions ?? 6;
  const predictHorizon = opts.predictHorizon ?? 20;

  const runner = ScenarioRunner.setup(opts.scenarioId);
  const operator = opts.operatorFactory?.(runner) ?? opts.operator ?? defaultBlindOperator;

  const timeline: BlindRun["trace"]["timeline"] = [];
  const calls: OperatorCall[] = [];
  const healthSequence: Health[] = [];

  // incident setup (blind: only ever read the agent view). `step()` force-matures
  // every disturbance — `settle()` would stop at the first steady fingerprint and
  // never reach the late-staggered primitives of 16.2/16.4 style scenarios.
  runner.start();
  runner.step(incidentSeconds);
  const firstView = runner.agentView();
  const firstObservationTime = firstView.timestamp;
  healthSequence.push(firstView.health);
  timeline.push({ t: firstObservationTime, event: "observed", detail: { health: firstView.health } });

  const expectedCauses = rootCausesOf(def);
  const expectedRecovery = def.expectedRecovery;

  // metric accumulators
  let invalidCount = 0;
  const invalidAttempts: string[] = [];
  const unnecessary: string[] = [];
  const perActionRisk: string[] = [];
  const policyDenials: string[] = [];
  let humanEscalations = 0;
  const humanDetail: string[] = [];
  let predictionSum = 0;
  let predictionN = 0;
  const executedActions: Array<{ type: string; parameters: Record<string, number | string> }> = [];
  let timeToRecovery: number | null = null;
  const snapshotBeforeLastAction: { kpis: BusinessKpis | null; metrics: unknown; health: Health | null } = {
    kpis: null,
    metrics: null,
    health: null,
  };

  const stateVersionAt = (t: number): number => Math.round(t);

  let operatorReview: OperatorDecision = { stop: true, reason: "run not started" };
  let firstCause: string | undefined;
  let healthyAt: number | null = null;

  for (let attempt = 0; attempt < maxActions; attempt++) {
    const view = runner.agentView();
    const decision = operator(view, { attempt });
    operatorReview = decision;
    if (attempt === 0) firstCause = decision.cause;
    timeline.push({
      t: view.timestamp,
      event: "decision",
      detail: { cause: decision.cause, action: decision.action, reason: decision.reason, escalate: decision.escalate },
    });

    if (decision.escalate) {
      humanEscalations += 1;
      humanDetail.push(`escalation at attempt ${attempt}: ${decision.reason ?? "no reason"}`);
    }

    const action = decision.action;
    if (!action || decision.stop) break;
    if (action.type === "do_nothing") {
      calls.push({ attempt, type: "do_nothing", parameters: action.parameters ?? {}, gateVerdict: null, executed: false });
      runner.settle(settleAfterAction);
      const hv = runner.agentView();
      healthSequence.push(hv.health);
      if (HEALTH_OK[hv.health]) {
        healthyAt = hv.timestamp;
        timeToRecovery = healthyAt - firstObservationTime;
        break;
      }
      continue;
    }

    // 1) policy check (optional control surface) — denials are policy violations + rejected calls.
    const gate = opts.policyCheck?.(action.type, action.parameters ?? {}, stateVersionAt(view.timestamp)) ?? null;
    if (gate && !gate.allowed) {
      invalidCount += 1;
      invalidAttempts.push(`${action.type} blocked by policy: ${gate.reason}`);
      policyDenials.push(`${action.type} at attempt ${attempt}: ${gate.reason}`);
      timeline.push({ t: view.timestamp, event: "policy_denied", detail: { type: action.type, reason: gate.reason } });
      continue;
    }

    // 2) blind prediction on the isolated branch (same surface the agent uses).
    let predicted: PredictionResult | null = null;
    try {
      predicted = runner.predict(createAction(action.type, action.parameters ?? {}), { horizonTicks: predictHorizon });
    } catch {
      predicted = null;
    }

    // 3) execute on the live execution world.
    const preHealth = runner.health();
    const preSnapshot = snapObservables(runner);
    const res = runner.executeChange(action.type, action.parameters ?? {});
    calls.push({
      attempt, type: action.type, parameters: action.parameters ?? {},
      gateVerdict: gate, executed: res.ok, unmet: res.unmet,
    });
    timeline.push({ t: view.timestamp, event: res.ok ? "executed" : "rejected", detail: { type: action.type, unmet: res.unmet } });

    if (!res.ok) {
      invalidCount += 1;
      invalidAttempts.push(`${action.type} rejected: ${res.unmet.join("; ")}`);
      continue;
    }

    preSnapshot.health = preHealth;
    snapshotBeforeLastAction.kpis = preSnapshot.kpis;
    snapshotBeforeLastAction.metrics = preSnapshot.metrics;
    snapshotBeforeLastAction.health = preSnapshot.health;
    executedActions.push({ type: action.type, parameters: action.parameters ?? {} });
    try {
      const decl = createAction(action.type as ActionType, action.parameters ?? {});
      perActionRisk.push(`${action.type}:${decl.risk}`);
    } catch {
      perActionRisk.push(`${action.type}:unknown`);
    }
    if (!expectedRecovery.includes(action.type)) {
      unnecessary.push(`${action.type}@${attempt}`);
    }

    // 4) let the causal model reflect the remediation, then re-observe.
    runner.step(settleAfterAction);
    const afterView = runner.agentView();
    healthSequence.push(afterView.health);

    // 5) prediction-vs-actual contribution for this action (captured even when
    //    the re-observation shows full recovery).
    if (predicted?.ok) {
      const acc = kpiAccuracy(predicted.kpis, afterView.kpis);
      predictionSum += acc;
      predictionN += 1;
    }

    if (HEALTH_OK[afterView.health] && healthyAt === null) {
      healthyAt = afterView.timestamp;
      timeToRecovery = healthyAt - firstObservationTime;
      break;
    }
  }

  const finalView = runner.agentView();
  const finalSystemHealth = finalView.health;
  if (healthyAt === null && timeToRecovery === null && HEALTH_OK[finalSystemHealth]) {
    // healthy without an explicit action (rare): recovery time is still measured.
    timeToRecovery = finalView.timestamp - firstObservationTime;
  }

  // ---- diagnosis accuracy ----
  const opCause = firstCause; // the operator's first diagnosis, before any remediation
  let diagnosisAccuracy: number | null = null;
  const diagnosisDetail: string[] = [`top cause: ${opCause ?? "none"}`, `true causes: ${expectedCauses.join(" / ")}`];
  if (opCause) {
    const norm = (s: string): string => s.toLowerCase();
    const root = expectedCauses[0];
    diagnosisAccuracy =
      norm(opCause) === norm(root) ? 1 : norm(expectedCauses.join("|")).includes(norm(opCause)) ? 0.75 : 0;
    diagnosisDetail.push(`accuracy: ${diagnosisAccuracy}`);
  }

  // ---- plan effectiveness ----
  const errorBefore = Number(firstView.kpis.checkoutErrorRate ?? 0);
  const errorAfter = Number(finalView.kpis.checkoutErrorRate ?? 0);
  const healthScore = finalSystemHealth === "healthy" ? 1 : finalSystemHealth === "degraded" ? 0.5 : 0;
  const errorReduction = errorBefore > 0 ? clamp((errorBefore - errorAfter) / errorBefore, 0, 1) : errorBefore === 0 ? 1 : 0;
  const planEffectiveness: number | null =
    executedActions.length > 0 ? Math.round((0.5 * healthScore + 0.5 * errorReduction) * 100) / 100 : null;

  // ---- tool selection ----
  const executedTypes = executedActions.filter((a) => a.type !== "do_nothing").map((a) => a.type);
  const used = [...new Set(executedTypes)];
  const hits = used.filter((t) => expectedRecovery.includes(t)).length;
  const toolScore = used.length > 0 ? hits / used.length : null;

  // ---- risk ----
  const riskOverall = riskRank(perActionRisk);

  // ---- rollback probe (after the final-health metric is captured) ----
  let rollbackSuccess: boolean | null = null;
  const rollbackDetail: string[] = [];
  if (executedActions.length > 0) {
    const rb = runner.rollback();
    runner.settle(5);
    const afterRollback = runner.agentView();
    const priorHealth = snapshotBeforeLastAction.health;
    rollbackSuccess = rb.ok && afterRollback.health === priorHealth;
    rollbackDetail.push(
      `rollback ${rb.ok ? "restored" : "failed"} → health ${afterRollback.health} (prior ${priorHealth ?? "n/a"})`,
      `checkout error pre-change ${snapshotKpi(snapshotBeforeLastAction, "checkoutErrorRate")} → post-rollback ${afterRollback.kpis.checkoutErrorRate}`
    );
  } else {
    rollbackDetail.push("no executed change to roll back");
  }

  const metrics: EvaluationMetrics = {
    diagnosisAccuracy: metric(diagnosisAccuracy, diagnosisAccuracy === null ? "collected-but-not-yet-valued" : "computed", diagnosisDetail),
    planEffectiveness: metric(planEffectiveness, planEffectiveness === null ? "collected-but-not-yet-valued" : "computed", [
      `eff = 0.5*health(${finalSystemHealth})+0.5*errReduction(${Math.round(errorReduction * 100)}%)`,
    ]),
    toolSelection: metric(
      { score: toolScore, used: used.length ? used : [], expected: expectedRecovery },
      toolScore === null ? "collected-but-not-yet-valued" : "computed"
    ),
    invalidCalls: metric({ count: invalidCount, attempts: invalidAttempts }, "computed"),
    timeToRecovery: metric(
      timeToRecovery,
      timeToRecovery === null ? "collected-but-not-yet-valued" : "computed",
      timeToRecovery === null ? [`never recovered in ≤${maxActions} actions`] : [`observed→healthy in ${timeToRecovery}s (sim)`]
    ),
    unnecessaryActions: metric({ count: unnecessary.length, detail: unnecessary }, "computed"),
    risk: metric(
      { overall: riskOverall, perAction: perActionRisk },
      perActionRisk.length === 0 ? "collected-but-not-yet-valued" : "computed"
    ),
    policyViolations: metric(
      { count: policyDenials.length === 0 && opts.policyCheck ? 0 : policyDenials.length === 0 ? null : policyDenials.length, detail: policyDenials },
      opts.policyCheck ? "computed" : "collected-but-not-yet-valued",
      opts.policyCheck
        ? undefined
        : ["no policy surface supplied to the core harness; the @change-room/evaluation package checks via the control layer"]
    ),
    humanInterventions: metric({ count: humanEscalations, detail: humanDetail }, "computed", [
      "automated blind run; escalations observed from the operator decision",
    ]),
    predictionAccuracy: metric(
      predictionN > 0 ? Math.round((predictionSum / predictionN) * 100) / 100 : null,
      predictionN > 0 ? "computed" : "collected-but-not-yet-valued",
      predictionN > 0 ? [`${predictionN} executed actions with a valid prediction`] : ["no action was predicted"]
    ),
    rollbackSuccess: metric(rollbackSuccess, rollbackSuccess === null ? "collected-but-not-yet-valued" : "computed", rollbackDetail),
    finalSystemHealth: metric(finalSystemHealth, "computed", ["health after the operator's run; the rollback probe runs afterwards"]),
  };

  // optional alert-only invalid-call probe: prove the surface rejects bad input.
  if (opts.probeInvalidCall) {
    const probe = runner.executeChange("increase_cache_capacity", { newCapacityGB: -5 });
    if (!probe.ok) {
      invalidCount += 1;
      invalidAttempts.push("increase_cache_capacity(newCapacityGB=-5) rejected by preconditions");
    }
    metrics.invalidCalls = metric({ count: invalidCount, attempts: invalidAttempts }, "computed");
  }

  return {
    scenarioId: opts.scenarioId,
    session: runner.session(),
    healthSequence,
    expectedCauses,
    metrics,
    groundTruth: runner.groundTruth(),
    trace: { operatorCalls: calls, timeline },
  };
}

function snapObservables(runner: ScenarioRunner): { health: Health; kpis: BusinessKpis; metrics: unknown } {
  const v = runner.agentView();
  return { health: v.health, kpis: v.kpis, metrics: JSON.parse(JSON.stringify(v.metrics)) };
}

function snapshotKpi(snap: { kpis: BusinessKpis | null }, key: string): number {
  const k = snap.kpis as Record<string, number> | null;
  return Number(k?.[key] ?? 0);
}

function kpiAccuracy(predicted: BusinessKpis, actual: BusinessKpis): number {
  const pairs: Array<[number, number, number]> = [
    [predicted.checkoutLatencyMs, actual.checkoutLatencyMs, 100],
    [predicted.checkoutErrorRate, actual.checkoutErrorRate, 1],
  ];
  let sum = 0;
  for (const [p, a, floor] of pairs) {
    const err = Math.abs(p - a) / Math.max(Math.abs(p), Math.abs(a), floor);
    sum += 1 - clamp(err, 0, 1);
  }
  return Math.round((sum / pairs.length) * 1000) / 1000;
}

function riskRank(perAction: string[]): "low" | "medium" | "high" | null {
  if (perAction.length === 0) return null;
  const rank: Record<string, number> = { low: 1, medium: 2, high: 3 };
  let worst: { name: string; r: number } = { name: "low", r: 0 };
  for (const entry of perAction) {
    const [, level] = entry.split(":") as [string, "low" | "medium" | "high"];
    const r = rank[level] ?? 0;
    if (r > worst.r) worst = { name: level, r };
  }
  return worst.name as "low" | "medium" | "high";
}