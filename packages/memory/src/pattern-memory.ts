/**
 * Pattern memory (implementation-v2.md §11.1).
 *
 * Detects and retains repeated decision patterns: the same state fingerprint
 * paired with the same action and a similar consequence. Repeated-pattern
 * handling lets the system flag recurring root causes rather than treating
 * each incident as ad hoc.
 */

import type { ConsequenceRecord } from "./consequence-memory.js";

export interface PatternRecord {
  patternId: string;
  fingerprint: string;
  actionType: string;
  outcomeKind: string;
  occurrences: number;
  lastLesson: string;
}

export class PatternMemory {
  private patterns: Map<string, PatternRecord> = new Map();

  private key(fingerprint: string, actionType: string): string {
    return `${fingerprint}::${actionType}`;
  }

  /** Feed a consequence back, coalescing successive repeats of the same pattern. */
  observe(consequence: ConsequenceRecord): PatternRecord {
    const k = this.key(consequence.prediction ? fingerprintOf(consequence.actual) : "", consequence.actionType);
    const existing = this.patterns.get(k);
    if (existing) {
      const updated: PatternRecord = {
        ...existing,
        occurrences: existing.occurrences + 1,
        lastLesson: consequence.lesson,
      };
      this.patterns.set(k, updated);
      return updated;
    }
    const fresh: PatternRecord = {
      patternId: `pattern_${this.patterns.size + 1}`,
      fingerprint: fingerprintOf(consequence.actual),
      actionType: consequence.actionType,
      outcomeKind: consequence.outcomeKind,
      occurrences: 1,
      lastLesson: consequence.lesson,
    };
    this.patterns.set(k, fresh);
    return fresh;
  }

  recurring(minOccurrences = 2): PatternRecord[] {
    return [...this.patterns.values()].filter((p) => p.occurrences >= minOccurrences);
  }

  all(): PatternRecord[] {
    return [...this.patterns.values()];
  }
}

function fingerprintOf(metrics: Record<string, number>): string {
  return Object.keys(metrics)
    .sort()
    .map((k) => `${k}:${metrics[k]}`)
    .join("|");
}
