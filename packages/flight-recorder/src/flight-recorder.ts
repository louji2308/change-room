/**
 * Change Room — flight recorder (Phase 11).
 *
 * An auditable, append-only event store covering the entire human+agent
 * operational lifecycle: events, decisions, tool calls and state changes.
 * Every event is assigned a monotonic sequence number and — crucially —
 * redacted of any sensitive secrets before it is ever stored.
 */

import type { ChangeRoomEvent, ChangeRoomEventType } from "./events.js";
import { redacted } from "./events.js";
import { buildReplay, type ReplayResult } from "./replay.js";

export interface FlightRecorderOptions {
  /** Maximum number of retained events (oldest dropped beyond this). */
  limit?: number;
}

export type RecordInput = Omit<ChangeRoomEvent, "seq" | "timestamp"> & {
  timestamp?: number;
};

export interface FlightRecorderSummary {
  count: number;
  byType: Record<string, number>;
  byActor: Record<string, number>;
  firstSeq: number;
  lastSeq: number;
}

export class FlightRecorder {
  readonly limit: number;
  private readonly events: ChangeRoomEvent[] = [];
  private nextSeq = 1;

  constructor(options: FlightRecorderOptions = {}) {
    this.limit = options.limit ?? 10000;
  }

  record(input: RecordInput): ChangeRoomEvent {
    const event: ChangeRoomEvent = {
      ...input,
      seq: this.nextSeq++,
      timestamp: input.timestamp ?? Date.now(),
      detail: redacted(input.detail),
    };
    this.events.push(event);
    while (this.events.length > this.limit) {
      this.events.shift();
    }
    return event;
  }

  all(): ChangeRoomEvent[] {
    return this.events.map((e) => ({ ...e }));
  }

  since(seq: number): ChangeRoomEvent[] {
    return this.events.filter((e) => e.seq > seq).map((e) => ({ ...e }));
  }

  byType(type: ChangeRoomEventType): ChangeRoomEvent[] {
    return this.events.filter((e) => e.type === type).map((e) => ({ ...e }));
  }

  forPlan(planId: string): ChangeRoomEvent[] {
    return this.events.filter((e) => e.planId === planId).map((e) => ({ ...e }));
  }

  replay(): ReplayResult {
    return buildReplay(this.events);
  }

  summary(): FlightRecorderSummary {
    const byType: Record<string, number> = {};
    const byActor: Record<string, number> = {};
    for (const e of this.events) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      byActor[e.actor] = (byActor[e.actor] ?? 0) + 1;
    }
    return {
      count: this.events.length,
      byType,
      byActor,
      firstSeq: this.events.length ? this.events[0]!.seq : 0,
      lastSeq: this.events.length ? this.events[this.events.length - 1]!.seq : 0,
    };
  }
}
