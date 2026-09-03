/**
 * Intent Contract (Idea.md §20).
 *
 * The human's goal, priorities, constraints and delegated authority, expressed
 * as structured constraints the agent must reason under. A contract must never
 * silently expand the agent's authority.
 */

export type Priority = "availability" | "cost" | "latency" | "safety" | "throughput";

/** How much authority the human has granted for this task (bounded delegation). */
export interface DelegationGrant {
  /** Allowed action risk ceiling (low/medium/high). */
  riskCeiling: "low" | "medium" | "high";
  /** Expiry time (ms epoch) after which the grant lapses. */
  expiresAt: number;
  /** Resource scope this grant applies to (empty = everywhere). */
  scope: string[];
  /** Whether a human approval is still required for every mutation. */
  approvalStillRequired: boolean;
}

export interface IntentContract {
  id: string;
  /** The human's natural-language goal, normalized into a short phrase. */
  goal: string;
  /** Priority ordering, most important first. */
  priorities: Priority[];
  /** Hard constraints the agent must respect. */
  constraints: string[];
  /** Explicitly forbidden operations. */
  forbidden: string[];
  /** Machine-readable forbidden action types (e.g. "scale_database"). */
  forbiddenActionTypes: string[];
  /** Machine-readable forbidden resources (e.g. "database", "inventory"). */
  forbiddenResources: string[];
  /** Default authority level before human amendment. */
  defaultAuthority: "L0" | "L1" | "L2" | "L3";
  /** Optional bounded delegation override. */
  delegation?: DelegationGrant;
  /** Created-at (ms epoch). */
  createdAt: number;
  /** Human (or system) who authored the contract. */
  author: string;
}

export function createIntentContract(partial: Partial<IntentContract> & { goal: string }): IntentContract {
  return {
    id: partial.id ?? `contract_${Date.now()}`,
    goal: partial.goal,
    priorities: partial.priorities ?? ["availability", "safety"],
    constraints: partial.constraints ?? [],
    forbidden: partial.forbidden ?? [],
    forbiddenActionTypes: partial.forbiddenActionTypes ?? [],
    forbiddenResources: partial.forbiddenResources ?? [],
    defaultAuthority: partial.defaultAuthority ?? "L0",
    delegation: partial.delegation,
    createdAt: partial.createdAt ?? Date.now(),
    author: partial.author ?? "human",
  };
}
