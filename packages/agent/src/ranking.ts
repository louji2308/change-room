/**
 * Multi-future ranking (implementation-v2.md §8.3).
 *
 * Ranks candidate future-plans across multiple dimensions (recovery, cost,
 * risk, robustness, business impact, customer impact). Never reduces the
 * decision to a single KPI; surfaces per-candidate reasons. Deterministic.
 */

export interface RankCandidate {
  planId: string;
  recovery: number; // 0..1
  cost: number; // 0..1, lower is better
  risk: "low" | "medium" | "high";
  robustness: number; // 0..1
  businessImpact: number; // 0..1
  customerImpact: number; // 0..1
  metrics: Record<string, number>;
}

export interface RankedCandidate {
  rank: number;
  planId: string;
  score: number;
  reasons: string[];
}

const RISK_SCORE: Record<RankCandidate["risk"], number> = { low: 0.9, medium: 0.6, high: 0.2 };

const WEIGHTS = {
  robustness: 0.3,
  recovery: 0.25,
  risk: 0.2,
  businessImpact: 0.15,
  customerImpact: 0.1,
  cost: 0, // penalize only in reasons, keep positive weighting for the rest
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Deterministic multi-dimensional ranking. Higher score = better plan. */
export function rankCandidates(candidates: RankCandidate[]): RankedCandidate[] {
  const scored = candidates.map((c) => {
    const robustness = clamp01(c.robustness);
    const recovery = clamp01(c.recovery);
    const riskScore = RISK_SCORE[c.risk];
    const business = clamp01(c.businessImpact);
    const customer = clamp01(c.customerImpact);
    const costPenalty = clamp01(c.cost) * 0.1; // small penalty for cost

    const score =
      WEIGHTS.robustness * robustness +
      WEIGHTS.recovery * recovery +
      WEIGHTS.risk * riskScore +
      WEIGHTS.businessImpact * business +
      WEIGHTS.customerImpact * customer -
      costPenalty;

    const reasons: string[] = [];
    reasons.push(`robustness ${(robustness * 100).toFixed(0)}% (w=${WEIGHTS.robustness})`);
    reasons.push(`recovery ${(recovery * 100).toFixed(0)}% (w=${WEIGHTS.recovery})`);
    reasons.push(`risk ${c.risk} -> ${riskScore.toFixed(2)} (w=${WEIGHTS.risk})`);
    reasons.push(`business impact ${(business * 100).toFixed(0)}% (w=${WEIGHTS.businessImpact})`);
    reasons.push(`customer impact ${(customer * 100).toFixed(0)}% (w=${WEIGHTS.customerImpact})`);
    if (costPenalty > 0) reasons.push(`cost penalty -${(costPenalty * 100).toFixed(1)}`);

    return { planId: c.planId, score: Math.round(score * 1000) / 1000, reasons };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s, i) => ({ rank: i + 1, ...s }));
}
