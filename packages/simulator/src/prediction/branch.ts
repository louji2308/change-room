/**
 * Prediction World (Simulator.md §22, §33).
 *
 * A prediction *branches* the current world: it deep-clones both the world
 * state and tuning, applies a proposed action, and simulates forward. The real
 * (execution) world is never touched — this is the hard isolation invariant.
 */

import { WorldState } from "../world/world-state.js";
import { cloneTuning } from "../world/tuning.js";
import type { WorldTuning } from "../world/tuning.js";
import { tick } from "../causal/engine.js";
import { applyAction } from "../actions/definitions.js";
import type { Action } from "../actions/definitions.js";
import { computeTuningAt } from "../disturbances/apply.js";
import type { Disturbance } from "../disturbances/generator.js";
import { observeMetrics, observeKpis, eventToLog } from "../observability/observe.js";
import type { MetricSeries, BusinessKpis, ObservableEvent, ObservableLog } from "../observability/observe.js";

export interface BranchOptions {
  world: WorldState;
  baseTuning: WorldTuning;
  disturbances: Disturbance[];
  action: Action;
  actionTime: number;
  tickSeconds?: number;
  horizonTicks?: number;
}

export interface PredictionResult {
  ok: boolean;
  unmet: string[];
  finalTuning: WorldTuning;
  metrics: MetricSeries[];
  kpis: BusinessKpis;
  logs: ObservableLog[];
  events: ObservableEvent[];
  worldVersion: number;
  fingerprint: string;
}

/**
 * Simulate `action` forward from a clone of the current world.
 * Returns the *predicted* state; the input `world` is left untouched.
 */
export function branchToPredict(opts: BranchOptions): PredictionResult {
  const tickSeconds = opts.tickSeconds ?? 1;
  const horizonTicks = opts.horizonTicks ?? 30;

  // 1) Deep-clone the execution world so we never mutate it.
  const world = opts.world.clone();

  // 2) Current tuning at the moment the action is taken (disturbances active).
  const currentTuning = computeTuningAt(opts.baseTuning, opts.disturbances, opts.actionTime);

  // 3) Apply the proposed action (validated). Failure => return early.
  const applied = applyAction(currentTuning, opts.action);
  if (!applied.ok) {
    return {
      ok: false,
      unmet: applied.unmet,
      finalTuning: currentTuning,
      metrics: [],
      kpis: observeKpis(world),
      logs: [],
      events: [],
      worldVersion: world.version,
      fingerprint: world.fingerprint(),
    };
  }

  // 4) Simulate forward; disturbances keep evolving so we get a realistic
  //    transient + steady state rather than an instant "healthy=true".
  const events: ObservableEvent[] = [];
  const times: Array<number> = [];
  const emit = (type: string, componentId: string, data: Record<string, unknown>) => {
    events.push({ time: times[times.length - 1] ?? opts.actionTime, type, componentId, data });
  };

  for (let i = 0; i < horizonTicks; i++) {
    const t = opts.actionTime + (i + 1) * tickSeconds;
    times.push(t);
    const tuningAt = computeTuningAt(applied.tuning, opts.disturbances, t);
    tick(world, tuningAt, tickSeconds, emit);
  }

  const metrics = observeMetrics(world);
  const kpis = observeKpis(world);
  const logs = events.map(eventToLog);
  const finalTuning = computeTuningAt(
    applied.tuning,
    opts.disturbances,
    opts.actionTime + horizonTicks * tickSeconds
  );

  return {
    ok: true,
    unmet: [],
    finalTuning,
    metrics,
    kpis,
    logs,
    events,
    worldVersion: world.version,
    fingerprint: world.fingerprint(),
  };
}
