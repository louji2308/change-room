/**
 * Branch Manager (§8) — simulatePlan + compareBranches.
 *
 * `simulatePlan` runs a plan's action SEQUENCE against an isolated clone of the
 * world snapshot. Each action is applied against the previous step's result, so
 * order matters. Every branch is deeply isolated from the current world.
 *
 * `compareBranches` returns a multi-dimensional comparison exposing recovery,
 * cost, risk, robustness, business impact, customer impact, and system metrics.
 *
 * §8.2 sequence simulation, §8.3 comparison, §27 data integrity.
 */

import { WorldState } from "../world/world-state.js";
import type { WorldTuning } from "../world/tuning.js";
import { cloneTuning } from "../world/tuning.js";
import { tick } from "../causal/engine.js";
import { applyAction } from "../actions/definitions.js";
import type { Action } from "../actions/definitions.js";
import { computeTuningAt } from "../disturbances/apply.js";
import { observeMetrics, observeKpis } from "../observability/observe.js";
import type { MetricSeries, BusinessKpis } from "../observability/observe.js";

/* ------------------------------------------------------------------ */
/* Local types — same shape as §3 WorldBranch / WorldSnapshot stubs   */
/* Reconciled by the integration agent after A1 lands.                */
/* ------------------------------------------------------------------ */

export interface LocalWorldSnapshot {
  id: string;
  revision: number;
  world: Record<string, unknown>;
  capturedAt: number;
  fingerprint: string;
}

export interface LocalWorldBranch {
  branchId: string;
  parentWorldRevision: number;
  originatingPlanId: string;
  actions: string[];
  initialState: LocalWorldSnapshot;
  finalState: LocalWorldSnapshot;
  metrics: Record<string, number>;
  health: "healthy" | "degraded" | "critical" | "recovered";
  businessImpact: number;
  risk: "low" | "medium" | "high";
  simulationDuration: number;
  assumptions: string[];
  outcome: "predicted" | "actual";
}

/* ------------------------------------------------------------------ */
/* Branch comparison result (§8.3) — multi-dimensional, never scalar  */
/* ------------------------------------------------------------------ */

export interface BranchComparison {
  branchId: string;
  /** Recovery quality 0..100 (100 = full recovery to healthy). */
  recovery: number;
  /** Estimated cost 0..100 (higher = more expensive intervention). */
  cost: number;
  /** Risk level derived from world state and action risk. */
  risk: "low" | "medium" | "high";
  /** Robustness score 0..100. */
  robustness: number;
  /** Business impact score 0..100 (100 = best business outcome). */
  businessImpact: number;
  /** Customer impact score 0..100 (100 = best customer experience). */
  customerImpact: number;
  /** Key system metrics at branch end. */
  systemMetrics: Record<string, number>;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function snapshotWorld(
  world: WorldState,
  id: string,
  revision: number
): LocalWorldSnapshot {
  return {
    id,
    revision,
    world: worldToRecord(world),
    capturedAt: Date.now(),
    fingerprint: world.fingerprint(),
  };
}

function worldToRecord(world: WorldState): Record<string, unknown> {
  const rec: Record<string, unknown> = { version: world.version };
  for (const [id, c] of world.components) {
    rec[id] = {
      inboundLoad: c.inboundLoad,
      utilization: c.utilization,
      latencyMs: c.latencyMs,
      queueDepth: c.queueDepth,
      errorRate: c.errorRate,
      degraded: c.degraded,
    };
  }
  return rec;
}

function deriveHealth(kpis: BusinessKpis): LocalWorldBranch["health"] {
  if (kpis.systemHealth === "down") return "critical";
  if (kpis.systemHealth === "degraded") return "degraded";
  return "healthy";
}

function deriveRisk(
  kpis: BusinessKpis,
  actionRisks: string[]
): LocalWorldBranch["risk"] {
  const hasHigh = actionRisks.includes("high");
  if (hasHigh || kpis.checkoutErrorRate > 15) return "high";
  if (kpis.checkoutErrorRate > 5 || kpis.systemHealth === "degraded")
    return "medium";
  return "low";
}

/**
 * Derive a business impact score from final KPIs.
 * 100 = ideal (fast checkout, no errors), 0 = worst.
 */
function deriveBusinessImpact(kpis: BusinessKpis): number {
  const latencyScore = Math.max(0, 100 - kpis.checkoutLatencyMs / 10);
  const errorScore = Math.max(0, 100 - kpis.checkoutErrorRate * 5);
  return Math.round((latencyScore * 0.6 + errorScore * 0.4) * 10) / 10;
}

/**
 * Derive a customer impact score from checkout and cache metrics.
 */
function deriveCustomerImpact(kpis: BusinessKpis): number {
  const successScore = kpis.checkoutSuccessRate;
  const latencyScore = Math.max(0, 100 - kpis.checkoutLatencyMs / 8);
  return Math.round(
    (successScore * 0.5 + latencyScore * 0.3 + kpis.cacheHitRateEstimate * 0.2) * 10
  ) / 10;
}

function metricsToRecord(metrics: MetricSeries[]): Record<string, number> {
  const rec: Record<string, number> = {};
  for (const m of metrics) {
    rec[`${m.componentId}.utilization`] = m.utilization;
    rec[`${m.componentId}.latencyMs`] = m.latencyMs;
    rec[`${m.componentId}.errorRate`] = m.errorRate;
    rec[`${m.componentId}.queueDepth`] = Math.round(m.queueDepth);
  }
  return rec;
}

function kpisFromMetrics(metrics: Record<string, number>): BusinessKpis {
  return {
    checkoutLatencyMs: metrics["checkout.latencyMs"] ?? 0,
    checkoutErrorRate: metrics["checkout.errorRate"] ?? 0,
    checkoutSuccessRate: Math.max(0, 100 - (metrics["checkout.errorRate"] ?? 0)),
    ordersThroughputPerSec: 0,
    cacheHitRateEstimate: Math.round(
      Math.max(20, 100 - (metrics["cache.utilization"] ?? 0) * 0.9)
    ),
    systemHealth:
      (metrics["checkout.errorRate"] ?? 0) > 20
        ? "down"
        : (metrics["checkout.errorRate"] ?? 0) > 5
          ? "degraded"
          : "healthy",
  };
}

function computeRecovery(
  health: LocalWorldBranch["health"],
  kpis: BusinessKpis
): number {
  if (health === "healthy")
    return Math.min(100, 90 + Math.min(10, 100 - kpis.checkoutLatencyMs / 10));
  if (health === "degraded")
    return Math.min(70, 40 + Math.min(30, 100 - kpis.checkoutErrorRate * 3));
  return Math.max(0, 20 - kpis.checkoutErrorRate);
}

function computeCost(actions: string[]): number {
  const costs: Record<string, number> = {
    do_nothing: 0,
    increase_cache_capacity: 15,
    restart_cache: 10,
    scale_service: 30,
    scale_database: 40,
    rollback_deployment: 50,
    change_configuration: 25,
    restore_configuration: 20,
  };
  let total = 0;
  for (const a of actions) total += costs[a] ?? 20;
  return Math.min(100, total);
}

function computeRobustness(branch: LocalWorldBranch): number {
  let base = 80;
  if (branch.health === "healthy") base = 90;
  if (branch.health === "critical") base = 20;
  if (branch.risk === "high") base -= 25;
  if (branch.risk === "medium") base -= 10;
  base -= branch.actions.length * 3;
  return Math.max(0, Math.min(100, base));
}

function pickSystemMetrics(
  metrics: Record<string, number>
): Record<string, number> {
  const important = [
    "checkout.latencyMs",
    "checkout.errorRate",
    "checkout.utilization",
    "cache.utilization",
    "database.latencyMs",
    "database.errorRate",
    "database.utilization",
  ];
  const out: Record<string, number> = {};
  for (const k of important) {
    if (k in metrics) out[k] = metrics[k];
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Public API                                                         */
/* ------------------------------------------------------------------ */

export interface SimulatePlanOpts {
  /** Deep-cloned world snapshot to branch from. */
  world: WorldState;
  /** Current tuning at snapshot time. */
  baseTuning: WorldTuning;
  /** Active disturbances. */
  disturbances: Array<{
    type: string;
    magnitude: number;
    start: number;
    ramp: number;
    duration: number;
  }>;
  /** Action time for the simulation start. */
  actionTime: number;
  /** Plan id for traceability. */
  planId: string;
  /** Ordered sequence of actions in the plan. */
  actions: Action[];
  /** Ticks to simulate after each action. */
  ticksPerAction?: number;
  /** Override tickSeconds. */
  tickSeconds?: number;
}

export interface SimulatePlanResult {
  branches: LocalWorldBranch[];
  /** The shared initial snapshot used by all branches. */
  initialSnapshot: LocalWorldSnapshot;
}

/**
 * Simulate a plan as an action SEQUENCE (§8.2).
 * Each action is applied against the PREVIOUS step's resulting world, so order
 * matters. Every step is deeply cloned — no mutation of the original world.
 *
 * Returns one WorldBranch per plan, recording the cumulative effect of the
 * entire action sequence.
 */
export function simulatePlan(opts: SimulatePlanOpts): SimulatePlanResult {
  const {
    world,
    baseTuning,
    disturbances,
    actionTime,
    planId,
    actions,
    ticksPerAction = 10,
    tickSeconds = 1,
  } = opts;

  const initialSnapshot = snapshotWorld(
    world,
    `${planId}_init`,
    world.version
  );

  // Deep clone so we never touch the authoritative world.
  let currentWorld = world.clone();
  let currentTuning = cloneTuning(baseTuning);
  const allActions: string[] = [];
  const allRisks: string[] = [];

  let simTime = actionTime;

  for (const action of actions) {
    allActions.push(action.type);
    allRisks.push(action.risk);

    // Validate and apply action to a copy of the current tuning.
    const applied = applyAction(currentTuning, action);
    if (!applied.ok) {
      // Action failed validation — branch ends here with the pre-action state.
      break;
    }
    currentTuning = applied.tuning;

    // Simulate forward `ticksPerAction` ticks with the modified tuning.
    for (let t = 0; t < ticksPerAction; t++) {
      simTime += tickSeconds;
      // Merge disturbances at this point in time.
      const tuningAtTime = computeTuningAt(currentTuning, disturbances as any, simTime);
      tick(currentWorld, tuningAtTime, tickSeconds);
    }
  }

  // Final observation of the accumulated branch world.
  const finalMetrics = observeMetrics(currentWorld);
  const finalKpis = observeKpis(currentWorld);
  const finalSnapshot = snapshotWorld(
    currentWorld,
    `${planId}_final`,
    currentWorld.version
  );

  const simDuration = simTime - actionTime;

  const branch: LocalWorldBranch = {
    branchId: `${planId}_branch`,
    parentWorldRevision: world.version,
    originatingPlanId: planId,
    actions: allActions,
    initialState: initialSnapshot,
    finalState: finalSnapshot,
    metrics: metricsToRecord(finalMetrics),
    health: deriveHealth(finalKpis),
    businessImpact: deriveBusinessImpact(finalKpis),
    risk: deriveRisk(finalKpis, allRisks),
    simulationDuration: simDuration,
    assumptions: [
      `seed deterministic`,
      `${actions.length} action(s) in sequence`,
      `${ticksPerAction} ticks per action`,
    ],
    outcome: "predicted",
  };

  return {
    branches: [branch],
    initialSnapshot,
  };
}

/**
 * Compare branches (§8.3). Returns structured, multi-dimensional results —
 * never a single KPI.
 */
export function compareBranches(
  branches: LocalWorldBranch[]
): BranchComparison[] {
  return branches.map((b) => {
    const kpis = kpisFromMetrics(b.metrics);

    return {
      branchId: b.branchId,
      recovery: computeRecovery(b.health, kpis),
      cost: computeCost(b.actions),
      risk: b.risk,
      robustness: computeRobustness(b),
      businessImpact: b.businessImpact,
      customerImpact: deriveCustomerImpact(kpis),
      systemMetrics: pickSystemMetrics(b.metrics),
    };
  });
}
