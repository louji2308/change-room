/**
 * Hypothesis (Idea.md §17–18). The agent maintains a belief set over the
 * possible cause of an incident, each with confidence, support and
 * counterevidence. Ground truth stays hidden; the agent reasons from evidence.
 */

export type HypothesisStatus = "proposed" | "investigating" | "supported" | "refuted" | "uncertain";

export interface Hypothesis {
  id: string;
  /** Candidate cause, e.g. "cache degradation". */
  cause: string;
  /** Agent belief 0..1. */
  confidence: number;
  /** Supporting evidence ids. */
  supporting: string[];
  /** Counterevidence ids. */
  counterevidence: string[];
  /** What evidence would still be needed to confirm/refute. */
  missingEvidence: string[];
  status: HypothesisStatus;
  /** How the confidence was derived (provenance, not chain-of-thought). */
  basis: string[];
}

export function createHypothesis(partial: Partial<Hypothesis> & { cause: string; confidence: number }): Hypothesis {
  return {
    id: partial.id ?? `hyp_${Date.now()}`,
    cause: partial.cause,
    confidence: partial.confidence,
    supporting: partial.supporting ?? [],
    counterevidence: partial.counterevidence ?? [],
    missingEvidence: partial.missingEvidence ?? [],
    status: partial.status ?? "proposed",
    basis: partial.basis ?? [],
  };
}
