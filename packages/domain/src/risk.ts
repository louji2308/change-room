/**
 * Risk model (Idea.md §23). Risk is never a single arbitrary number: it is a
 * multi-axis assessment covering blast radius, user impact, dependency impact,
 * data risk, reversibility, confidence, state freshness and policy sensitivity.
 */

export type RiskSeverity = "low" | "medium" | "high";

export interface RiskFactors {
  blastRadius: RiskSeverity;
  userImpact: RiskSeverity;
  dependencyImpact: RiskSeverity;
  dataRisk: RiskSeverity;
  reversibility: "fully-reversible" | "partially-reversible" | "compensating" | "irreversible";
  confidence: number; // 0..1
  stateFreshness: "fresh" | "stale" | "unknown";
  policySensitivity: RiskSeverity;
}

export interface RiskAssessment {
  /** Rolled-up severity (derived from the factors). */
  overall: RiskSeverity;
  /** Individual factors — never collapsed into one number. */
  factors: Partial<RiskFactors>;
  reversible: boolean;
}

/** Collapse the multi-axis factors into an overall severity in a deterministic way. */
export function overallRisk(factors: Partial<RiskFactors>): RiskSeverity {
  const scores: number[] = [];
  let highCount = 0;
  for (const k of ["blastRadius", "userImpact", "dependencyImpact", "dataRisk", "policySensitivity"] as const) {
    const v = factors[k];
    if (!v) continue;
    if (v === "high") {
      scores.push(3);
      highCount++;
    } else if (v === "medium") scores.push(2);
    else scores.push(1);
  }
  if (factors.reversibility === "irreversible") {
    scores.push(3);
    highCount++;
  } else if (factors.reversibility === "compensating") scores.push(2);
  else if (factors.reversibility === "partially-reversible") scores.push(2);

  if (scores.length === 0) return "medium";
  // Safety-first: any single high factor or irreversibility dominates to high.
  if (highCount >= 1) return "high";
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (avg >= 2) return "medium";
  return "low";
}
