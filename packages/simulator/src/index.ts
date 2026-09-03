/**
 * Change Room — Operational Simulator (Phase 2)
 */

export { SeededRng } from "./kernel/rng.js";
export { SimulationClock } from "./kernel/clock.js";
export { EventScheduler } from "./kernel/scheduler.js";
export type { DiscreteEvent } from "./kernel/scheduler.js";

export { TOPOLOGY, topologyById, downstreamIds, upstreamOf } from "./world/topology.js";
export type { ComponentDef, ComponentKind } from "./world/topology.js";
export { WorldState } from "./world/world-state.js";
export type { ComponentState } from "./world/world-state.js";
export { defaultTuning, cloneTuning, effectiveCapacity, effectiveServiceTime } from "./world/tuning.js";
export type { WorldTuning } from "./world/tuning.js";

export { clamp, latencyOf, errorRateOf, updateQueueDepth, utilizationOf, backpressureMultiplier } from "./causal/rules.js";
export { tick, cacheMissRatio } from "./causal/engine.js";
export type { TickResult, EventFn } from "./causal/engine.js";
export { validateWorld, repairWorld } from "./causal/constraints.js";
export type { ConstraintViolation } from "./causal/constraints.js";

export { generateDisturbances, cacheDegradationDemo } from "./disturbances/generator.js";
export type { Disturbance, DisturbanceType } from "./disturbances/generator.js";
export { computeTuningAt, healthyTuning } from "./disturbances/apply.js";

export { createAction, applyAction } from "./actions/definitions.js";
export type { Action, ActionType, RiskLevel } from "./actions/definitions.js";

export { branchToPredict } from "./prediction/branch.js";
export type { BranchOptions, PredictionResult } from "./prediction/branch.js";

export { observeMetrics, observeKpis, eventToLog } from "./observability/observe.js";
export type { MetricSeries, BusinessKpis, ObservableEvent, ObservableLog } from "./observability/observe.js";

export { WorldSimulator } from "./simulator.js";
export type { SimulatorOptions } from "./simulator.js";

// V2 — Environment & Living World (§6.2)
export {
  computeEnvMultipliers,
  generateBaselineConditions,
  zeroMultipliers,
} from "./environment/conditions.js";
export type {
  EnvironmentCondition,
  EnvironmentConditionKind,
  EnvMultipliers,
} from "./environment/conditions.js";

export { LivingWorld } from "./environment/living.js";
export type { LivingWorldOptions, AdvanceResult } from "./environment/living.js";

export {
  generateEnvironmentEvents,
  applyEnvironmentEvent,
  EnvironmentStream,
} from "./environment/environment-stream.js";
export type {
  EnvironmentEvent,
  EnvironmentEventKind,
} from "./environment/environment-stream.js";

// V2 — World Generator (§7)
export { generateWorld } from "./world-generator.js";
export type { WorldGeneratorOpts, GeneratedWorld } from "./world-generator.js";

// V2 — Plan Simulation / Branch Manager (§8)
export { simulatePlan, compareBranches } from "./plan-simulation/branch-manager.js";
export type {
  SimulatePlanOpts,
  SimulatePlanResult,
  LocalWorldSnapshot,
  LocalWorldBranch,
  BranchComparison,
} from "./plan-simulation/branch-manager.js";
