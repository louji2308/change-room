/**
 * Human decision (Idea.md §30). The human can approve, reject, modify, ask for
 * more evidence, challenge, or take control. The agent must respect it.
 */

export type HumanDecisionKind = "approve" | "reject" | "modify" | "more-evidence" | "challenge" | "take-control";

export interface HumanDecision {
  id: string;
  kind: HumanDecisionKind;
  /** What this decision applies to (plan id / request id). */
  subjectId: string;
  note: string;
  /** Human actor. */
  actor: string;
  timestamp: number;
  /** For "modify": how the contract/plan changed. */
  change?: unknown;
}
