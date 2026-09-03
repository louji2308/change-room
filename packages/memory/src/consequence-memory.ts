/**
 * Consequence memory (implementation-v2.md §11).
 *
 * Stores the real consequence of each executed action so the system can learn
 * from outcomes. History is evidence, not an automatic answer: retrieval is a
 * separate concern (retrieval.ts).
 */

export interface ConsequenceRecord {
  consequenceId: string;
  planId: string;
  actionType: string;
  prediction: Record<string, number>;
  actual: Record<string, number>;
  error: number;
  outcomeKind: string;
  nextAction: string;
  cause: string;
  lesson: string;
  createdAt: number;
}

let seq = 0;

export class ConsequenceMemory {
  private items: ConsequenceRecord[] = [];

  record(input: Omit<ConsequenceRecord, "consequenceId" | "createdAt">): ConsequenceRecord {
    const rec: ConsequenceRecord = { ...input, consequenceId: `consequence_${++seq}`, createdAt: Date.now() };
    this.items.push(rec);
    return rec;
  }

  all(): ConsequenceRecord[] {
    return [...this.items];
  }

  forPlan(planId: string): ConsequenceRecord[] {
    return this.items.filter((r) => r.planId === planId);
  }

  count(): number {
    return this.items.length;
  }
}
