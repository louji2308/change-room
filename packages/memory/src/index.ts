/**
 * Change Room — Operational decision memory (implementation-v2.md §11).
 *
 * A single facade combining decision memory, consequence memory, pattern memory
 * and retrieval, so the rest of the system has one persistence + query surface
 * for "what did we decide, what happened, and what should we remember?".
 */

import type {
  DecisionMemoryRecord,
} from "./decision-memory.js";
import { recordDecision } from "./decision-memory.js";
import { ConsequenceMemory, type ConsequenceRecord } from "./consequence-memory.js";
import { PatternMemory, type PatternRecord } from "./pattern-memory.js";
import { retrieveSimilar, type RetrievedDecision } from "./retrieval.js";
import { fingerprintState } from "./fingerprint.js";

export type { DecisionMemoryRecord } from "./decision-memory.js";
export type { ConsequenceRecord } from "./consequence-memory.js";
export type { PatternRecord } from "./pattern-memory.js";
export type { RetrievedDecision } from "./retrieval.js";

export interface RecordDecisionInput {
  hypothesis: string;
  planId: string;
  assumptions: string[];
  prediction: Record<string, number>;
  actual: Record<string, number>;
  predictionError: number;
  outcome: DecisionMemoryRecord["outcome"];
  humanOverride: boolean;
  lesson: string;
}

export class DecisionMemory {
  private decisions: DecisionMemoryRecord[] = [];
  private consequences = new ConsequenceMemory();
  private patterns = new PatternMemory();

  record(input: RecordDecisionInput): DecisionMemoryRecord {
    const rec = recordDecision({
      stateFingerprint: fingerprintState(input.actual ?? {}),
      ...input,
    });
    this.decisions.push(rec);
    return rec;
  }

  /** Record a consequence and feed pattern memory. */
  recordConsequence(consequence: Omit<ConsequenceRecord, "consequenceId" | "createdAt">): ConsequenceRecord {
    const rec = this.consequences.record(consequence);
    this.patterns.observe(rec);
    return rec;
  }

  decisionsAll(): DecisionMemoryRecord[] {
    return [...this.decisions];
  }

  count(): number {
    return this.decisions.length;
  }

  /** Retrieve the k most similar past decisions for a current state. */
  query(currentState: Record<string, number>, k = 5): RetrievedDecision[] {
    return retrieveSimilar(this.decisions, currentState, k).hits;
  }

  recurringPatterns(minOccurrences = 2): PatternRecord[] {
    return this.patterns.recurring(minOccurrences);
  }

  consequencesAll(): ConsequenceRecord[] {
    return this.consequences.all();
  }
}
