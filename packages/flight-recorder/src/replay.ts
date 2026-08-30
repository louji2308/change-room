/**
 * Change Room — replay (Phase 11).
 *
 * Reconstructs a coherent, chronological timeline from the raw event stream.
 * Events are always sorted by sequence number so the story is never shown
 * out of order; the result also reports completeness and any gaps in the
 * recorded series.
 */

import type {
  Actor,
  ChangeRoomEvent,
  ChangeRoomEventType,
} from "./events.js";

export interface ReplayStep {
  seq: number;
  timestamp: number;
  actor: Actor;
  type: ChangeRoomEventType;
  summary: string;
}

export interface ReplayResult {
  steps: ReplayStep[];
  complete: boolean;
  missingGaps: number;
  partial: boolean;
}

function summarize(event: ChangeRoomEvent): string {
  const parts: string[] = [];
  if (event.planId) {
    parts.push(`plan:${event.planId}`);
  }
  if (event.tool) {
    parts.push(`tool:${event.tool}`);
  }
  if (event.inputSummary) {
    parts.push(event.inputSummary);
  }
  return `${event.type.toUpperCase()}${parts.length ? ` (${parts.join(", ")})` : ""}`;
}

/**
 * Builds a chronological replay from the given events. Events are sorted by seq
 * ascending regardless of input order. `complete` is true only when the
 * timeline has both a start (intent_contract_set or observation) and an end
 * (incident_complete); otherwise the timeline is `partial`. `missingGaps`
 * counts the number of holes in the sequence number series.
 */
export function buildReplay(events: ChangeRoomEvent[]): ReplayResult {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);

  const steps: ReplayStep[] = sorted.map((event) => ({
    seq: event.seq,
    timestamp: event.timestamp,
    actor: event.actor,
    type: event.type,
    summary: summarize(event),
  }));

  const hasStart = sorted.some(
    (e) => e.type === "intent_contract_set" || e.type === "observation"
  );
  const hasEnd = sorted.some((e) => e.type === "incident_complete");

  let missingGaps = 0;
  for (let i = 1; i < sorted.length; i++) {
    missingGaps += Math.max(0, sorted[i]!.seq - sorted[i - 1]!.seq - 1);
  }

  const complete = hasStart && hasEnd;
  return {
    steps,
    complete,
    missingGaps,
    partial: !complete,
  };
}
