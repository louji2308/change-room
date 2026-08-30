/**
 * Plan (Architecture.md §7; Idea.md §21).
 *
 * Every plan is a structured object created from a state snapshot, carrying
 * actions, expected outcome, evidence, assumptions, confidence, risk, blast
 * radius, reversibility, policy result, required authority and a lifecycle
 * status. It always records the `stateVersion` it was built against so the
 * control layer can reject stale plans.
 */

import type { ActionType } from "@change-room/simulator";
import type { RiskAssessment } from "./risk.js";

export type PlanStatus =
  | "DRAFT"
  | "SIMULATED"
  | "READY"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "EXECUTING"
  | "VERIFYING"
  | "COMPLETED"
  | "FAILED"
  | "STALE"
  | "REJECTED"
  | "ROLLED_BACK";

export interface PlanAction {
  /** Operator-facing type ("increase_cache_capacity", ...). */
  type: ActionType | string;
  /** Parameters to pass to the simulator/createAction. */
  parameters?: Record<string, number | string>;
  /** Human description of what this step does. */
  description: string;
}

export interface Plan {
  id: string;
  /** Short human name, e.g. "Increase cache capacity". */
  name: string;
  /** The operational objective this plan serves. */
  objective: string;
  /** Actions, in order. */
  actions: PlanAction[];
  /** State version this plan was built against (for stale-detection). */
  stateVersion: number;
  /** Expected outcome (from simulation), human-readable + metric summary. */
  expectedOutcome: string;
  /** Predicted end-state KPIs (checkoutLatencyMs etc.). */
  predictedKpis?: Partial<Record<string, number>>;
  /** Evidence ids supporting this plan. */
  evidence: string[];
  /** Assumptions the plan relies on. */
  assumptions: string[];
  /** Agent confidence 0..1. */
  confidence: number;
  /** Full multi-axis risk assessment. */
  risk: RiskAssessment;
  /** Blast radius label. */
  blastRadius: "low" | "medium" | "high";
  /** Reversibility classification. */
  reversibility: "fully-reversible" | "partially-reversible" | "compensating" | "irreversible";
  /** Policy decision (allowed? approval required?). */
  policy: { allowed: boolean; approvalRequired: boolean; reason: string };
  /** Authority needed to execute. */
  requiredAuthority: string;
  /** Cost of execution (conceptual). */
  cost: "low" | "medium" | "high";
  /** Lifecycle status. */
  status: PlanStatus;
  /** Do-nothing counterfactual flag. */
  isDoNothing?: boolean;
  createdAt: number;
}

export function createPlan(partial: Partial<Plan> & Pick<Plan, "name" | "objective" | "actions" | "stateVersion">): Plan {
  return {
    id: partial.id ?? `plan_${Date.now()}`,
    name: partial.name,
    objective: partial.objective,
    actions: partial.actions,
    stateVersion: partial.stateVersion,
    expectedOutcome: partial.expectedOutcome ?? "",
    predictedKpis: partial.predictedKpis,
    evidence: partial.evidence ?? [],
    assumptions: partial.assumptions ?? [],
    confidence: partial.confidence ?? 0,
    risk: partial.risk ?? { overall: "medium", factors: {}, reversible: true },
    blastRadius: partial.blastRadius ?? "low",
    reversibility: partial.reversibility ?? "fully-reversible",
    policy: partial.policy ?? { allowed: true, approvalRequired: false, reason: "" },
    requiredAuthority: partial.requiredAuthority ?? "L1",
    cost: partial.cost ?? "low",
    status: partial.status ?? "DRAFT",
    isDoNothing: partial.isDoNothing ?? false,
    createdAt: partial.createdAt ?? Date.now(),
  };
}
