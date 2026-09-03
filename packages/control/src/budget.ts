/**
 * Risk Budget system (Implementation.md §13).
 *
 * A deterministic, inspectable budget that limits how much risk the agent
 * can accumulate per planning window. Each action type has a fixed cost
 * derived from its inherent risk; costs increase when the risk level is
 * elevated. The gate checks the budget before authorising execution and
 * releases the cost when the action completes or is rolled back.
 */

export interface RiskBudget {
  /** Total budget pool. */
  total: number;
  /** Amount allocated so far. */
  allocated: number;
  /** Remaining = total − allocated. */
  remaining: number;
}

export interface ActionCost {
  type: string;
  cost: number;
}

export const DEFAULT_ACTION_COSTS: Record<string, number> = {
  increase_cache_capacity: 3,
  restart_cache: 2,
  scale_service: 5,
  scale_database: 8,
  rollback_deployment: 12,
  change_configuration: 4,
  restore_configuration: 3,
  do_nothing: 0,
};

const RISK_MULTIPLIER: Record<string, number> = {
  low: 1,
  medium: 1.5,
  high: 2,
};

export class RiskBudgetManager {
  budget: RiskBudget;

  constructor(totalBudget: number = 32) {
    this.budget = { total: totalBudget, allocated: 0, remaining: totalBudget };
  }

  /** Deterministic cost for an action type at a given risk level. */
  costOf(actionType: string, riskLevel: string): number {
    const base = DEFAULT_ACTION_COSTS[actionType] ?? 5;
    const mult = RISK_MULTIPLIER[riskLevel] ?? 1;
    return Math.ceil(base * mult);
  }

  /** Check whether the budget can cover the action without allocating. */
  canAfford(actionType: string, riskLevel: string = "low"): boolean {
    return this.costOf(actionType, riskLevel) <= this.budget.remaining;
  }

  /** Backward-compatible remaining accessor (method form for RiskBudgetLike). */
  remaining(): number {
    return this.budget.remaining;
  }

  /** Attempt to reserve budget for an action. Returns true on success. */
  allocate(actionType: string, riskLevel: string): boolean {
    const cost = this.costOf(actionType, riskLevel);
    if (cost > this.budget.remaining) return false;
    this.budget.allocated += cost;
    this.budget.remaining = this.budget.total - this.budget.allocated;
    return true;
  }

  /** Release previously allocated budget (e.g. on rollback or completion). */
  release(actionType: string, cost: number): void {
    this.budget.allocated = Math.max(0, this.budget.allocated - cost);
    this.budget.remaining = this.budget.total - this.budget.allocated;
  }

  /** Reset the entire budget to initial state. */
  reset(): void {
    this.budget.allocated = 0;
    this.budget.remaining = this.budget.total;
  }
}
