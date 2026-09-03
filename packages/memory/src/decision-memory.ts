/**
 * Decision memory (implementation-v2.md §11.2).
 *
 * A structured, append-oriented record of a consequential decision: the
 * hypothesis it rested on, the plan, the predicted vs actual outcome, the
 * prediction error, the human override if any, and the lesson.
 */

import type { AgentDecisionType } from "@change-room/domain";

export interface DecisionMemoryRecord {
  decisionId: string;
  stateFingerprint: string;
  hypothesis: string;
  planId: string;
  assumptions: string[];
  prediction: Record<string, number>;
  actual: Record<string, number>;
  predictionError: number;
  outcome: AgentDecisionType;
  humanOverride: boolean;
  lesson: string;
  createdAt: number;
}

let seq = 0;

/** Append a decision record and return it with its generated id. */
export function recordDecision(input: Omit<DecisionMemoryRecord, "decisionId" | "createdAt">): DecisionMemoryRecord {
  return {
    ...input,
    decisionId: `decision_${++seq}`,
    createdAt: Date.now(),
  };
}
