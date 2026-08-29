/**
 * Disturbance generator (Simulator.md §10, §23, §25).
 *
 * Instead of predefined "failure scenarios", disturbances are *compositions of
 * primitives* with bounded magnitudes drawn from a seeded RNG. Consequences
 * emerge when the causal engine runs them against the world over time.
 */

import { SeededRng } from "../kernel/rng.js";

export type DisturbanceType =
  | "traffic_spike"
  | "cache_degradation"
  | "database_contention"
  | "dependency_latency"
  | "deployment_memory"
  | "queue_backlog"
  | "configuration_regression";

export interface Disturbance {
  id: string;
  type: DisturbanceType;
  /** Semantic magnitude, bounded to a plausible range by the generator. */
  magnitude: number;
  /** Sim seconds when the effect starts ramping in. */
  start: number;
  /** Seconds over which the effect ramps to full strength. */
  ramp: number;
  /** Seconds the effect is held; 0 means it persists indefinitely. */
  duration: number;
  /** Human-readable, cause-oriented description (kept for ground truth only). */
  description: string;
}

const MAGNITUDE_RANGES: Record<DisturbanceType, [number, number]> = {
  traffic_spike: [1.3, 2.8], // +30% .. +180% traffic
  cache_degradation: [0.5, 0.85], // capacity multiplier down to 50..85%
  database_contention: [0.6, 0.9], // DB capacity multiplier
  dependency_latency: [120, 400], // extra ms on payment
  deployment_memory: [1.4, 2.4], // api-gateway latency multiplier effect
  queue_backlog: [0.35, 0.6], // queue capacity multiplier down 35..60%
  configuration_regression: [0.7, 0.9], // database capacity regression offset
};

function pickCombination(rng: SeededRng): DisturbanceType[] {
  const pool: DisturbanceType[] = [
    "traffic_spike",
    "cache_degradation",
    "database_contention",
    "dependency_latency",
    "deployment_memory",
    "queue_backlog",
    "configuration_regression",
  ];
  // Generate a plausible environment with 1..3 co-occurring primitives.
  const count = rng.int(1, 3);
  const chosen: DisturbanceType[] = [];
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  for (let i = 0; i < count; i++) chosen.push(shuffled[i]);
  return chosen;
}

/**
 * Generate a seeded, constrained disturbance environment.
 * Same `seed` => same environment (reproducibility, Simulator.md §23).
 */
export function generateDisturbances(seed: number, baselineStart = 60): Disturbance[] {
  const rng = new SeededRng(seed);
  const types = pickCombination(rng);
  const disturbances: Disturbance[] = [];

  let t = baselineStart;
  for (const type of types) {
    const [lo, hi] = MAGNITUDE_RANGES[type];
    const magnitude = Math.round(rng.range(lo, hi) * 100) / 100;
    const ramp = rng.range(20, 45);
    const duration = 0; // persists until recovered
    const description = describe(type, magnitude);
    disturbances.push({
      id: `dist_${type}`,
      type,
      magnitude,
      start: t,
      ramp,
      duration,
      description,
    });
    t += rng.range(15, 40);
  }
  return disturbances;
}

function describe(type: DisturbanceType, magnitude: number): string {
  switch (type) {
    case "traffic_spike":
      return `traffic grows to ${Math.round((magnitude - 1) * 100)}% above baseline`;
    case "cache_degradation":
      return `cache effective capacity drops to ${Math.round(magnitude * 100)}%`;
    case "database_contention":
      return `database connection pool reduced to ${Math.round(magnitude * 100)}%`;
    case "dependency_latency":
      return `payment dependency adds ${magnitude}ms latency`;
    case "deployment_memory":
      return `deployment creates memory pressure ${Math.round(magnitude * 100)}% on the gateway`;
    case "queue_backlog":
      return `background queue capacity drops to ${Math.round(magnitude * 100)}%`;
    case "configuration_regression":
      return `configuration drift reduces database pool to ${Math.round(magnitude * 100)}% and adds latency`;
  }
}

/**
 * The canonical signature-demo disturbance: cache degradation (Phase 21).
 * Kept as a *disturbance* — the symptoms (checkout latency ↑, cache hit ↓,
 * DB pressure ↑, checkout errors ↑) all emerge from the causal engine.
 */
export function cacheDegradationDemo(seed = 1234): Disturbance[] {
  const rng = new SeededRng(seed);
  return [
    {
      id: "dist_demo_cache_degradation",
      type: "cache_degradation",
      magnitude: 0.55,
      start: 60,
      ramp: Math.round(rng.range(20, 40)),
      duration: 0,
      description: "cache effective capacity drops to 55%",
    },
  ];
}
