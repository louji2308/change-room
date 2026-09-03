/**
 * LivingWorld — a world that evolves through environmental conditions without
 * requiring a named "incident start." Environmental pressures ramp in
 * autonomously over simulated time, producing genuine degradation cascades:
 *   workload rise → dependency latency → cache pressure → queue → checkout.
 *
 * §6.2 continuous world evolution, §6.3 deterministic seeds.
 */

import { SimulationClock } from "../kernel/clock.js";
import { SeededRng } from "../kernel/rng.js";
import { WorldState } from "../world/world-state.js";
import { TOPOLOGY } from "../world/topology.js";
import { defaultTuning, cloneTuning } from "../world/tuning.js";
import type { WorldTuning } from "../world/tuning.js";
import { tick } from "../causal/engine.js";
import { computeTuningAt } from "../disturbances/apply.js";
import type { Disturbance } from "../disturbances/generator.js";
import {
  computeEnvMultipliers,
  generateBaselineConditions,
} from "./conditions.js";
import type { EnvironmentCondition, EnvMultipliers } from "./conditions.js";
import { observeMetrics, observeKpis } from "../observability/observe.js";
import type { MetricSeries, BusinessKpis } from "../observability/observe.js";

export interface LivingWorldOptions {
  seed: number;
  trafficLevel?: number;
  tickSeconds?: number;
  conditions?: EnvironmentCondition[];
  /** External disturbances from the Disturbance system (e.g. cacheDegradationDemo). */
  disturbances?: Disturbance[];
}

export interface AdvanceResult {
  ticksAdvanced: number;
  currentTime: number;
  kpis: BusinessKpis;
  metrics: MetricSeries[];
  envMultipliers: EnvMultipliers;
}

/**
 * Apply environment-condition multipliers on top of disturbance-merged tuning.
 * Returns a fresh tuning; neither input is mutated.
 */
function mergeEnvIntoTuning(
  tuning: WorldTuning,
  env: EnvMultipliers
): WorldTuning {
  const out = cloneTuning(tuning);

  // Traffic workload ramp
  out.trafficLevel = Math.round(out.trafficLevel * env.trafficScale);

  // Capacity reductions
  out.capacityMultiplier.cache =
    (out.capacityMultiplier.cache ?? 1) * env.cacheCapacityScale;
  out.capacityMultiplier.database =
    (out.capacityMultiplier.database ?? 1) * env.dbCapacityScale;
  out.capacityMultiplier.queue =
    (out.capacityMultiplier.queue ?? 1) * env.queueCapacityScale;
  out.capacityMultiplier["api-gateway"] =
    (out.capacityMultiplier["api-gateway"] ?? 1) * env.gatewayCapacityScale;

  // Latency additions
  out.latencyModifier.payment =
    (out.latencyModifier.payment ?? 0) + env.paymentLatencyMs;
  out.latencyModifier.database =
    (out.latencyModifier.database ?? 0) + env.databaseLatencyMs;
  out.latencyModifier["api-gateway"] =
    (out.latencyModifier["api-gateway"] ?? 0) + env.gatewayLatencyMs;

  return out;
}

export class LivingWorld {
  readonly seed: number;
  readonly world: WorldState;
  readonly baseTuning: WorldTuning;
  readonly conditions: EnvironmentCondition[];
  readonly disturbances: Disturbance[];
  readonly clock: SimulationClock;
  readonly tickSeconds: number;

  constructor(opts: LivingWorldOptions) {
    this.seed = opts.seed;
    this.tickSeconds = opts.tickSeconds ?? 1;
    this.world = new WorldState(TOPOLOGY.map((c) => c.id));
    this.baseTuning = defaultTuning(opts.trafficLevel ?? 1500);
    this.conditions = opts.conditions ?? generateBaselineConditions(opts.seed);
    this.disturbances = opts.disturbances ?? [];
    this.clock = new SimulationClock(0);
  }

  /**
   * Run the causal model until the world reaches a stable baseline.
   * Environmental conditions are NOT active during baseline (they start at
   * or after their startTime, which defaults to after the baseline window).
   */
  runBaseline(seconds = 60): void {
    for (let i = 1; i <= seconds; i++) {
      this.clock.advance(this.tickSeconds);
      const perSecond =
        this.baseTuning.trafficLevel * Math.min(1, i / 10);
      tick(this.world, defaultTuning(Math.round(perSecond)), this.tickSeconds);
    }
  }

  /**
   * Advance the living world by `ticks` steps (or until `until` time).
   * Each tick applies:
   *   1. Disturbance-merged tuning (existing system)
   *   2. Environment-condition multipliers (new living-world layer)
   *   3. Causal engine tick
   */
  advance(ticks?: number, until?: number): AdvanceResult {
    const maxTicks = ticks ?? 1;
    let advanced = 0;

    for (let i = 0; i < maxTicks; i++) {
      if (until !== undefined && this.clock.now >= until) break;

      this.clock.advance(this.tickSeconds);
      const time = this.clock.now;

      // 1. Base tuning merged with named disturbances.
      let tuning = computeTuningAt(
        this.baseTuning,
        this.disturbances,
        time
      );

      // 2. Merge in environment-condition multipliers.
      const env = computeEnvMultipliers(this.conditions, time);
      tuning = mergeEnvIntoTuning(tuning, env);

      // 3. Causal tick.
      tick(this.world, tuning, this.tickSeconds);
      advanced++;
    }

    return {
      ticksAdvanced: advanced,
      currentTime: this.clock.now,
      kpis: observeKpis(this.world),
      metrics: observeMetrics(this.world),
      envMultipliers: computeEnvMultipliers(this.conditions, this.clock.now),
    };
  }

  /** Observe current state. */
  observe(): {
    metrics: MetricSeries[];
    kpis: BusinessKpis;
    worldVersion: number;
    currentTime: number;
  } {
    return {
      metrics: observeMetrics(this.world),
      kpis: observeKpis(this.world),
      worldVersion: this.world.version,
      currentTime: this.clock.now,
    };
  }
}
