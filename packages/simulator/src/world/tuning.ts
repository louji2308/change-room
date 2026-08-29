/**
 * World tuning — the perturbable "static-ish" parameters of the world.
 *
 * Disturbances mutate tuning (traffic level, capacity multipliers, latency
 * modifiers); the causal engine turns those into dynamic, emergent effects on
 * component state. This keeps disturbances separate from live state, so the
 * simulator produces consequences rather than scripted numbers.
 */

export interface WorldTuning {
  /** Inbound request rate applied at the traffic node every tick. */
  trafficLevel: number;
  /** Per-component capacity multiplier (1 = healthy, < 1 = degraded). */
  capacityMultiplier: Record<string, number>;
  /** Per-component extra latency added on top of model latency (ms). */
  latencyModifier: Record<string, number>;
}

export function defaultTuning(trafficLevel = 1200): WorldTuning {
  return {
    trafficLevel,
    capacityMultiplier: {},
    latencyModifier: {},
  };
}

export function cloneTuning(t: WorldTuning): WorldTuning {
  return {
    trafficLevel: t.trafficLevel,
    capacityMultiplier: { ...t.capacityMultiplier },
    latencyModifier: { ...t.latencyModifier },
  };
}

/** Effective capacity of a component given tuning + topology. */
export function effectiveCapacity(defCapacity: number, tuning: WorldTuning, componentId: string): number {
  const m = tuning.capacityMultiplier[componentId] ?? 1;
  return defCapacity * m;
}

/** Effective service-time baseline given tuning. */
export function effectiveServiceTime(defServiceTimeMs: number, tuning: WorldTuning, componentId: string): number {
  return defServiceTimeMs + (tuning.latencyModifier[componentId] ?? 0);
}
