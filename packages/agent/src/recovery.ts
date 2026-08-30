/**
 * Recovery reasoning (Implementation.md §6.6; Idea.md §34–35).
 *
 * After execution + verification, the agent decides how to respond to the
 * deviation: continue, adapt, escalate to the human, rollback, or stop. It
 * never auto-rolls-back every imperfect outcome — rollback is itself a
 * consequential decision.
 */

export type RecoveryDecision =
  | { action: "continue"; reason: string }
  | { action: "adapt"; reason: string; evidenceGap: string[] }
  | { action: "escalate"; reason: string }
  | { action: "rollback"; reason: string }
  | { action: "stop"; reason: string };

export interface RecoveryInput {
  /** Verification verdict (HEALTHY/DEGRADED/REGRESSION/UNKNOWN). */
  verdict: "HEALTHY" | "DEGRADED" | "REGRESSION" | "UNKNOWN";
  /** Target KPIs are back within a healthy envelope? */
  recovered: boolean;
  /** Whether the executed change was reversible. */
  reversible: boolean;
  /** Whether the agent still has time / budget to retry. */
  budgetRemaining: boolean;
  /** Whether prediction substantially differed from reality. */
  predictionBad: boolean;
}

/**
 * Deterministically select a recovery response from the verification outcome.
 * Safety-first: severe regressions escalate; unrecoverable situations stop.
 */
export function decideRecovery(input: RecoveryInput): RecoveryDecision {
  if (input.verdict === "HEALTHY" && input.recovered) {
    return { action: "continue", reason: "System reached the target state; continue monitoring." };
  }

  if (input.verdict === "REGRESSION") {
    if (input.reversible && input.budgetRemaining) {
      return { action: "rollback", reason: "Change caused a regression; rolling back to a known-good state." };
    }
    return {
      action: "escalate",
      reason: "Change caused a regression and recovery is not safely reversible/within budget; escalate to human.",
    };
  }

  if (input.verdict === "DEGRADED") {
    if (input.budgetRemaining) {
      return {
        action: "adapt",
        reason: "Outcome is partially acceptable; adapt the plan and re-simulate.",
        evidenceGap: ["insufficient post-change observation"],
      };
    }
    return { action: "escalate", reason: "Still degraded and budget exhausted; escalate to human." };
  }

  if (input.verdict === "UNKNOWN") {
    if (!input.recovered) {
      return { action: "escalate", reason: "Could not verify the outcome; escalate to human for judgement." };
    }
    return { action: "continue", reason: "Outcome unverifiable but target reached; continue cautiously." };
  }

  return { action: "stop", reason: "Unexpected state; stopping to avoid unverified actions." };
}
