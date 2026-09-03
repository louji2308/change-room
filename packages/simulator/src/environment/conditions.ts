/**
 * Environment conditions — an appendable set of environmental pressures that
 * evolve over simulated time. These feed `computeTuningAt` indirectly: the
 * `LivingWorld` merges environment-driven multipliers into the tuning before
 * each tick. No named "incident start" is required; degradation emerges as
 * conditions ramp in autonomously.
 *
 * §6.2 continuous world evolution, §7 environment variability.
 */

import { SeededRng } from "../kernel/rng.js";

export type EnvironmentConditionKind =
  | "workload_ramp"
  | "dependency_latency"
  | "cache_pressure"
  | "db_pool_saturation"
  | "memory_pressure"
  | "network_degradation";

export interface EnvironmentCondition {
  id: string;
  kind: EnvironmentConditionKind;
  /** Sim seconds when this condition begins ramping. */
  startTime: number;
  /** Peak intensity 0..1 (0 = no effect, 1 = maximum pressure). */
  intensity: number;
  /** Seconds over which the condition reaches full intensity. */
  ramp: number;
  /** Duration at full intensity; 0 = persists indefinitely. */
  holdDuration: number;
  /** Seconds over which the condition decays after holdDuration; 0 = no decay. */
  decay: number;
  /** Seed offset for deterministic within-kind variation. */
  seedOffset: number;
}

export interface EnvMultipliers {
  /** Additive extra latency on payment dependency (ms). */
  paymentLatencyMs: number;
  /** Additive extra latency on database (ms). */
  databaseLatencyMs: number;
  /** Additive extra latency on api-gateway (ms). */
  gatewayLatencyMs: number;
  /** Multiplicative traffic scale (1 = normal). */
  trafficScale: number;
  /** Multiplicative capacity reduction on cache (1 = normal). */
  cacheCapacityScale: number;
  /** Multiplicative capacity reduction on database (1 = normal). */
  dbCapacityScale: number;
  /** Multiplicative capacity reduction on queue (1 = normal). */
  queueCapacityScale: number;
  /** Multiplicative capacity reduction on api-gateway (1 = normal). */
  gatewayCapacityScale: number;
}

export function zeroMultipliers(): EnvMultipliers {
  return {
    paymentLatencyMs: 0,
    databaseLatencyMs: 0,
    gatewayLatencyMs: 0,
    trafficScale: 1,
    cacheCapacityScale: 1,
    dbCapacityScale: 1,
    queueCapacityScale: 1,
    gatewayCapacityScale: 1,
  };
}

function envelopeFactor(cond: EnvironmentCondition, time: number): number {
  const elapsed = time - cond.startTime;
  if (elapsed <= 0) return 0;

  const rampUp = Math.min(1, elapsed / Math.max(1, cond.ramp));

  if (cond.holdDuration === 0) {
    // No hold — ramps up and persists.
    return rampUp;
  }

  const holdEnd = cond.ramp + cond.holdDuration;
  if (elapsed <= holdEnd) return rampUp;

  if (cond.decay <= 0) {
    // Held at peak, no decay specified — stays at peak.
    return rampUp;
  }

  const decayProgress = Math.min(1, (elapsed - holdEnd) / Math.max(1, cond.decay));
  return Math.max(0, rampUp * (1 - decayProgress));
}

/**
 * Compute combined environmental multipliers at simulation time `t`.
 * Deterministic: same conditions + same time => same output.
 */
export function computeEnvMultipliers(
  conditions: EnvironmentCondition[],
  time: number
): EnvMultipliers {
  const out = zeroMultipliers();

  for (const c of conditions) {
    const f = envelopeFactor(c, time);
    if (f <= 0) continue;

    // Use a seeded jitter based on condition id hash so that two conditions
    // of the same kind don't perfectly overlap.
    const rng = new SeededRng(hashString(c.id + c.seedOffset));
    const jitter = 0.9 + rng.next() * 0.2; // 0.9 .. 1.1

    switch (c.kind) {
      case "workload_ramp": {
        out.trafficScale += (c.intensity - 1) * f * jitter;
        break;
      }
      case "dependency_latency": {
        out.paymentLatencyMs += c.intensity * 200 * f * jitter;
        break;
      }
      case "cache_pressure": {
        out.cacheCapacityScale *= 1 - c.intensity * 0.45 * f * jitter;
        break;
      }
      case "db_pool_saturation": {
        out.dbCapacityScale *= 1 - c.intensity * 0.35 * f * jitter;
        out.databaseLatencyMs += c.intensity * 30 * f * jitter;
        break;
      }
      case "memory_pressure": {
        out.gatewayCapacityScale *= 1 - c.intensity * 0.3 * f * jitter;
        out.gatewayLatencyMs += c.intensity * 15 * f * jitter;
        break;
      }
      case "network_degradation": {
        out.queueCapacityScale *= 1 - c.intensity * 0.25 * f * jitter;
        out.paymentLatencyMs += c.intensity * 80 * f * jitter;
        break;
      }
    }
  }

  return out;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/**
 * Generate a deterministic set of environment conditions from a seed.
 * Used by the world generator to produce baseline environmental variability.
 */
export function generateBaselineConditions(
  seed: number,
  startTime = 0
): EnvironmentCondition[] {
  const rng = new SeededRng(seed);
  const kinds: EnvironmentConditionKind[] = [
    "workload_ramp",
    "dependency_latency",
    "cache_pressure",
    "db_pool_saturation",
    "memory_pressure",
    "network_degradation",
  ];

  const count = rng.int(2, 4);
  const conditions: EnvironmentCondition[] = [];

  const shuffled = [...kinds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  let t = startTime;
  for (let i = 0; i < count; i++) {
    const kind = shuffled[i];
    const intensity = Math.round(rng.range(0.3, 0.8) * 100) / 100;
    const ramp = Math.round(rng.range(30, 90));
    const holdDuration = Math.round(rng.range(0, 120));
    const decay = holdDuration > 0 ? Math.round(rng.range(20, 60)) : 0;

    conditions.push({
      id: `env_${kind}_${i}`,
      kind,
      startTime: t,
      intensity,
      ramp,
      holdDuration,
      decay,
      seedOffset: seed + i,
    });
    t += rng.range(20, 60);
  }

  return conditions;
}
