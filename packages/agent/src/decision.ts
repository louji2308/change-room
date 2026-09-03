/**
 * Agent decision + abstention mode (implementation-v2.md §10).
 *
 * Deterministically decides whether to PROCEED, ASK_HUMAN, COLLECT_EVIDENCE, or
 * ABSTAIN given state freshness, granted authority, evidence sufficiency and
 * plan robustness. Abstention is a valid successful decision when evidence or
 * robustness is insufficient — never a forced action.
 */

import type { AgentDecision, DecisionConfidence } from "@change-room/domain";

export type AuthorityLevel = "L0" | "L1" | "L2" | "L3" | "L4";

export interface DecisionInput {
  worldRevision: number;
  confidence: DecisionConfidence;
  requiredAuthority: AuthorityLevel;
  grantedAuthority: AuthorityLevel;
  hasEnoughEvidence: boolean;
  stateFresh: boolean;
  robustness: number; // 0..1
  robustnessThreshold?: number; // default 0.6
  evidenceThreshold?: number; // default 0.5 (diagnosis confidence below this and no evidence => ASK_HUMAN)
}

const AUTHORITY_RANK: Record<AuthorityLevel, number> = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 };

/** Deterministic decision rule. Returns the chosen AgentDecision. */
export function decide(input: DecisionInput): AgentDecision {
  const robustnessThreshold = input.robustnessThreshold ?? 0.6;
  const evidenceThreshold = input.evidenceThreshold ?? 0.5;

  if (!input.stateFresh) {
    return { type: "ABSTAIN", worldRevision: input.worldRevision, confidence: input.confidence, reason: "state is stale; decision would be unsafe", requiredAuthority: input.requiredAuthority, missing: ["stale-state"] };
  }
  if (AUTHORITY_RANK[input.grantedAuthority] < AUTHORITY_RANK[input.requiredAuthority]) {
    return { type: "ABSTAIN", worldRevision: input.worldRevision, confidence: input.confidence, reason: `granted authority ${input.grantedAuthority} below required ${input.requiredAuthority}`, requiredAuthority: input.requiredAuthority, missing: ["insufficient-authority"] };
  }
  if (!input.hasEnoughEvidence) {
    return { type: "COLLECT_EVIDENCE", worldRevision: input.worldRevision, confidence: input.confidence, reason: "evidence is insufficient to act confidently", requiredAuthority: input.requiredAuthority, missing: ["evidence"] };
  }
  if (input.robustness < robustnessThreshold) {
    return { type: "ABSTAIN", worldRevision: input.worldRevision, confidence: input.confidence, reason: `plan robustness ${input.robustness.toFixed(2)} below threshold ${robustnessThreshold}`, requiredAuthority: input.requiredAuthority, missing: ["low-robustness"] };
  }
  if (input.confidence.diagnosis < evidenceThreshold && !input.hasEnoughEvidence) {
    return { type: "ASK_HUMAN", worldRevision: input.worldRevision, confidence: input.confidence, reason: "diagnostic confidence is low; human judgment is warranted", requiredAuthority: input.requiredAuthority, missing: [] };
  }
  return { type: "PROCEED", worldRevision: input.worldRevision, confidence: input.confidence, reason: "decision is fresh, authorized, evidence-backed and robust", requiredAuthority: input.requiredAuthority, missing: [] };
}
