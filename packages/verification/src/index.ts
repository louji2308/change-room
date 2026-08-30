/**
 * Change Room — Prediction vs Reality engine (Phase 9).
 *
 * Implementation.md §8/§9: after a plan executes, compare the predicted KPIs
 * against the actually observed outcome and classify the deviation so the
 * agent can decide whether the change held (HEALTHY), drifted (DEGRADED),
 * made things worse (REGRESSION) or lacks enough evidence (UNKNOWN).
 */

export * from "./verdict.js";
export * from "./store.js";