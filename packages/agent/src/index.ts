/**
 * Change Room — Agent orchestration (Phase 6).
 *
 * The agent reasons over the observable world: it parses intent, investigates,
 * forms ranked hypotheses, generates multiple candidate plans, simulates them on
 * an isolated prediction world, and decides how to recover from deviations. It
 * holds no state-changing authority and never touches hidden ground truth.
 */

export { parseIntent } from "./intent.js";
export { investigate, type InvestigationResult } from "./investigation.js";
export { formHypotheses } from "./hypotheses.js";
export { candidatesFor, buildPlans, type PlanCandidate } from "./planning.js";
export { simulatePlan, type SimulatedPlan } from "./simulation.js";
export { decideRecovery, type RecoveryDecision, type RecoveryInput } from "./recovery.js";
export { AgentOrchestrator, type AgentContext, type AgentReasoningResult } from "./orchestrator.js";
