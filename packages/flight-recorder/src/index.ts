/**
 * Change Room — Flight Recorder (Phase 11).
 *
 * An auditable event store that records the entire human+agent operational
 * lifecycle (events, decisions, tool calls, state changes) plus a replay
 * capability that reconstructs a coherent chronological timeline. It never
 * stores sensitive secrets.
 */

export * from "./events.js";
export * from "./flight-recorder.js";
export * from "./replay.js";
