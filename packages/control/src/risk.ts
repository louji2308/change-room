/**
 * Risk engine (Implementation.md §5.2; Idea.md §23).
 *
 * Computes a multi-axis risk assessment for an operation from its action
 * semantics (blast radius, reversibility, affected dependencies) plus context
 * (confidence, state freshness, policy sensitivity). Uses the shared domain
 * `overallRisk` collapse so the result is deterministic and inspectable.
 */

import type { RiskAssessment, RiskFactors } from "@change-room/domain";
import { overallRisk } from "@change-room/domain";

export interface RiskInput {
  /** Affected resources (component ids). */
  affected: string[];
  /** Reversibility of the operation. */
  reversibility: RiskFactors["reversibility"];
  /** Affected resources that are upstream dependencies of many others. */
  dependencyDepth?: number;
  /** Agent confidence in the diagnosis (0..1). */
  confidence?: number;
  /** Whether the plan's state snapshot is current. */
  stateFreshness?: RiskFactors["stateFreshness"];
  /** User-visible impact (default medium). */
  userImpact?: RiskFactors["userImpact"];
  /** Data risk (default low). */
  dataRisk?: RiskFactors["userImpact"];
  /** The action's own declared risk (low/medium/high). */
  declaredRisk?: "low" | "medium" | "high";
}

/** Map a component id to an estimated blast radius and dependency reach. */
const BLAST_BY_SCOPE: Record<string, RiskFactors["blastRadius"]> = {
  database: "high",
  "api-gateway": "medium",
  checkout: "high",
  queue: "medium",
  cache: "low",
  inventory: "medium",
  payment: "high",
  orders: "medium",
  traffic: "low",
  configuration: "low",
};

export function assessRisk(input: RiskInput): RiskAssessment {
  const reversibility = input.reversibility;
  const declared = input.declaredRisk ?? "low";
  const blastRadius =
    input.affected.length > 3 ? "high" : input.affected.length > 1 ? "medium" : "low";
  const dependencyImpact = declared === "high" ? "high" : input.dependencyDepth && input.dependencyDepth > 2 ? "high" : "medium";
  const userImpact = input.userImpact ?? "medium";
  const dataRisk = input.dataRisk ?? "low";
  const confidence = input.confidence ?? 0.5;
  const stateFreshness = input.stateFreshness ?? "unknown";
  const policySensitivity = declared === "high" ? "high" : "medium";

  const factors: Partial<RiskFactors> = {
    blastRadius,
    userImpact,
    dependencyImpact,
    dataRisk,
    reversibility,
    confidence,
    stateFreshness,
    policySensitivity,
  };

  const overall = overallRisk(factors);
  return { overall, factors, reversible: reversibility !== "irreversible" };
}

export { overallRisk };
export type { RiskAssessment, RiskFactors };
