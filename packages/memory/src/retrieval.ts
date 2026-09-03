/**
 * Memory retrieval (implementation-v2.md §11.3).
 *
 * For a new (current) state, compute its fingerprint and retrieve the most
 * similar historical decisions by structural distance. Retrieval adjusts
 * evidence/ranking/confidence is the caller's responsibility; this module finds
 * candidates scored by similarity.
 */

import type { DecisionMemoryRecord } from "./decision-memory.js";
import { stateDistance } from "./fingerprint.js";

export interface RetrievedDecision extends DecisionMemoryRecord {
  similarity: number; // 0..1, 1 = identical fingerprint
}

export interface RetrievalResult {
  query: Record<string, number>;
  hits: RetrievedDecision[];
}

/**
 * Rank stored decisions by similarity to the query state. Returns the top `k`
 * with their similarity score. Empty history yields no hits (not an error).
 */
export function retrieveSimilar(
  history: DecisionMemoryRecord[],
  query: Record<string, number>,
  k = 5
): RetrievalResult {
  const scored = history
    .map((rec) => {
      const similarity = 1 - stateDistance(query, rec.actual ?? {});
      return { rec, similarity };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);
  return {
    query,
    hits: scored.map(({ rec, similarity }) => ({ ...rec, similarity })),
  };
}
