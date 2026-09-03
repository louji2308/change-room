/**
 * V2 agent decision types.
 *
 * These represent the four possible stances the agent can take after
 * evaluating world state, confidence, and policy constraints.
 */

import type { DecisionConfidence } from "./v2-confidence.js";

export type AgentDecisionType =
  | "PROCEED"
  | "ASK_HUMAN"
  | "COLLECT_EVIDENCE"
  | "ABSTAIN";

export interface AgentDecision {
  /** The stance the agent is taking. */
  type: AgentDecisionType;
  /** World revision the decision was made against. */
  worldRevision: number;
  /** Multi-dimensional confidence breakdown. */
  confidence: DecisionConfidence;
  /** Human-readable reasoning. */
  reason: string;
  /** Authority level required for the chosen action. */
  requiredAuthority: "L0" | "L1" | "L2" | "L3" | "L4";
  /** What's missing (evidence, approval, freshness, …). */
  missing: string[];
}
