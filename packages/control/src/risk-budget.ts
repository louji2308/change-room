/**
 * Risk budget (Implementation.md §13.4).
 *
 * A deterministic, bounded risk budget.  Each action type has a cost; when the
 * remaining budget cannot cover the cost the action is refused and the caller
 * must seek human approval.  The budget never goes negative.
 */

export interface RiskBudgetOptions {
  /** Starting budget for the session/epoch. */
  initialBudget: number;
}

export interface ActionCostMap {
  /** Cost per action type string. */
  [actionType: string]: number;
}

const DEFAULT_ACTION_COST = 1;

export class RiskBudget {
  private _remaining: number;
  private readonly _initialBudget: number;
  private readonly _costs: ActionCostMap;

  constructor(opts: RiskBudgetOptions, costs: ActionCostMap) {
    this._initialBudget = opts.initialBudget;
    this._remaining = opts.initialBudget;
    this._costs = { ...costs };
  }

  remaining(): number {
    return this._remaining;
  }

  canAfford(actionType: string): boolean {
    const cost = this._costFor(actionType);
    return this._remaining >= cost;
  }

  spend(actionType: string): { ok: boolean; remaining: number; reason: string } {
    const cost = this._costFor(actionType);
    if (cost > this._remaining) {
      return {
        ok: false,
        remaining: this._remaining,
        reason: `insufficient risk budget: action '${actionType}' costs ${cost} but only ${this._remaining} remaining`,
      };
    }
    this._remaining -= cost;
    return {
      ok: true,
      remaining: this._remaining,
      reason: `action '${actionType}' spent ${cost}`,
    };
  }

  reset(): void {
    this._remaining = this._initialBudget;
  }

  private _costFor(actionType: string): number {
    if (actionType in this._costs) {
      return this._costs[actionType];
    }
    return DEFAULT_ACTION_COST;
  }
}
