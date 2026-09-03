/**
 * Change Room — Change Control layer (Phase 5).
 *
 * The single authoritative security/correctness boundary between the agent and
 * any state-changing action. Nothing consequential may go directly
 * Agent -> Medusa/simulator; every operation passes through this layer, which
 * validates policy, computes risk, checks authority (including bounded
 * delegation), rejects stale plans and detects concurrent changes.
 */

export * from "./policy.js";
export * from "./risk.js";
export * from "./permissions.js";
export * from "./authority.js";
export * from "./stale-plan.js";
export * from "./conflict.js";
export * from "./gate.js";
export * from "./autonomy.js";
export { RiskBudget, type RiskBudgetOptions, type ActionCostMap } from "./risk-budget.js";
export * from "./budget.js";
