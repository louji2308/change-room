/**
 * Outcome analysis (implementation-v2.md §12).
 *
 * After execution, classify the real-world outcome combining the verification
 * verdict (prediction vs reality) with business/KPI impact. Crucially, a
 * worse-than-predicted state must route to RE-INVESTIGATE, never a forced
 * SUCCESS.
 */

import type { Verdict } from "./verdict.js";

export type OutcomeKind = "SUCCESS" | "PARTIAL_RECOVERY" | "FAILURE" | "DEVIATION";

export interface OutcomeInput {
  planId: string;
  verdict: Verdict;
  /** e.g. checkoutSuccessRate after execution (0..100). */
  successRate: number;
  /** e.g. checkoutLatencyMs after execution. */
  latencyMs: number;
  /** thresholds used to separate success/partial/failure. */
  successThreshold?: number;
  partialThreshold?: number;
}

export interface OutcomeAnalysis {
  planId: string;
  kind: OutcomeKind;
  nextAction: "verify" | "reinvestigate" | "recover";
  reason: string;
}

/**
 * Map a verification verdict + live KPIs to a concrete outcome and next action.
 * - HEALTHY (+ success rate above threshold) -> SUCCESS, verify done.
 * - DEGRADED with moderate success -> PARTIAL_RECOVERY, still verify then adapt.
 * - REGRESSION or low success -> DEVIATION/FAILURE -> re-investigate.
 * A worse-than-predicted state is always re-investigated (never fake SUCCESS).
 */
export function analyzeOutcome(input: OutcomeInput): OutcomeAnalysis {
  const successThreshold = input.successThreshold ?? 95; // percent
  const partialThreshold = input.partialThreshold ?? 80;

  if (input.verdict === "REGRESSION" || input.successRate < partialThreshold) {
    return {
      planId: input.planId,
      kind: input.successRate < partialThreshold ? "FAILURE" : "DEVIATION",
      nextAction: "reinvestigate",
      reason:
        input.successRate < partialThreshold
          ? `success rate ${input.successRate}% below recovery threshold — the change did not hold; re-investigate.`
          : "actual deviated materially from prediction and did not hold; re-investigate rather than claim success.",
    };
  }

  if (input.successRate < successThreshold) {
    return {
      planId: input.planId,
      kind: "PARTIAL_RECOVERY",
      nextAction: "verify",
      reason: `success rate ${input.successRate}% is below the healthy bar; partial recovery — verify then consider follow-up.`,
    };
  }

  if (input.verdict === "DEGRADED") {
    return {
      planId: input.planId,
      kind: "PARTIAL_RECOVERY",
      nextAction: "verify",
      reason: "metrics moved but stayed within healthy bounds; verify the drift source.",
    };
  }

  return {
    planId: input.planId,
    kind: "SUCCESS",
    nextAction: "verify",
    reason: "actual matched prediction and success is healthy.",
  };
}
