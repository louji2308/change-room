/**
 * Change Room — Operational Simulator (top-level orchestrator).
 *
 * Builds a causal world, runs it to a stability baseline, injects seeded,
 * constrained disturbances, and exposes observation + prediction branching.
 *
 * The simulator *produces* consequences via the causal engine; it never hands
 * the agent hidden ground truth (see Simulator.md §28–29).
 */

import { SimulationClock } from "./kernel/clock.js";
import { SeededRng } from "./kernel/rng.js";
import { WorldState } from "./world/world-state.js";
import { TOPOLOGY } from "./world/topology.js";
import { defaultTuning } from "./world/tuning.js";
import type { WorldTuning } from "./world/tuning.js";
import { tick } from "./causal/engine.js";
import { validateWorld } from "./causal/constraints.js";
import { generateDisturbances, cacheDegradationDemo } from "./disturbances/generator.js";
import type { Disturbance } from "./disturbances/generator.js";
import { computeTuningAt, healthyTuning } from "./disturbances/apply.js";
import { branchToPredict } from "./prediction/branch.js";
import type { BranchOptions, PredictionResult } from "./prediction/branch.js";
import { observeMetrics, observeKpis, eventToLog } from "./observability/observe.js";
import type { MetricSeries, BusinessKpis, ObservableEvent, ObservableLog } from "./observability/observe.js";
import type { Action } from "./actions/definitions.js";
import {
  generateBaselineConditions,
  computeEnvMultipliers,
} from "./environment/conditions.js";
import type { EnvironmentCondition, EnvMultipliers } from "./environment/conditions.js";

export interface SimulatorOptions {
  seed: number;
  trafficLevel?: number;
  baselineSeconds?: number;
  tickSeconds?: number;
  /** Optional explicit disturbances; defaults to a seeded random set. */
  disturbances?: Disturbance[];
  /** "demo" uses the canonical cache-degradation signature scenario. */
  scenario?: "demo" | "random";
  /** Optional environmental conditions for living-world evolution. */
  conditions?: EnvironmentCondition[];
}

export class WorldSimulator {
  readonly seed: number;
  readonly world: WorldState;
  readonly baseTuning: WorldTuning;
  readonly disturbances: Disturbance[];
  readonly clock: SimulationClock;
  readonly tickSeconds: number;
  readonly conditions: EnvironmentCondition[];

  private events: ObservableEvent[] = [];
  private incidentStarted = false;

  constructor(opts: SimulatorOptions) {
    this.seed = opts.seed;
    this.tickSeconds = opts.tickSeconds ?? 1;
    this.world = new WorldState(TOPOLOGY.map((c) => c.id));
    this.baseTuning = defaultTuning(opts.trafficLevel ?? 1500);
    this.conditions = opts.conditions ?? generateBaselineConditions(opts.seed);
    if (opts.disturbances) {
      this.disturbances = opts.disturbances;
    } else if (opts.scenario === "demo") {
      this.disturbances = cacheDegradationDemo(opts.seed);
    } else {
      this.disturbances = generateDisturbances(opts.seed);
    }
    this.clock = new SimulationClock(0);
  }

  /** Run the causal model until the world reaches a stable baseline. */
  runBaseline(seconds = 60): void {
    const rng = new SeededRng(this.seed * 2 + 1);
    let perSecond = this.baseTuning.trafficLevel;
    // gentle ramp to avoid an artificial startup spike
    for (let i = 1; i <= seconds; i++) {
      perSecond = this.baseTuning.trafficLevel * Math.min(1, i / 10);
      this.clock.advance(this.tickSeconds);
      tick(this.world, defaultTuning(Math.round(perSecond)), this.tickSeconds);
    }
  }

  /** Begin the incident: disturbances start applying on subsequent ticks. */
  startIncident(): void {
    this.incidentStarted = true;
    this.emit("incident_started", "traffic", {
      seed: this.seed,
      disturbances: this.disturbances.map((d) => d.type),
    });
  }

  /** Advance the simulation by `seconds` (defaults to one tick). */
  step(seconds?: number): void {
    const s = seconds ?? this.tickSeconds;
    for (let i = 0; i < s; i++) {
      this.clock.advance(this.tickSeconds);
      const time = this.clock.now;
      const tuning = computeTuningAt(this.baseTuning, this.disturbances, time);
      tick(this.world, tuning, this.tickSeconds, (type, componentId, data) => {
        this.emit(type, componentId, data);
      });
    }
  }

  /** Advance until the world reaches a (near) steady state. */
  settle(maxSeconds = 60): void {
    let prev = "";
    for (let i = 0; i < maxSeconds && this.incidentStarted; i++) {
      this.step(1);
      const fp = this.world.fingerprint();
      if (fp === prev) break;
      prev = fp;
    }
  }

  /**
   * Advance the living world by `ticks` steps (or until `until` time).
   * Unlike `step()`, this method merges environment-condition multipliers into
   * the tuning before each tick, so the world degrades WITHOUT a named incident.
   * §6.2 continuous world evolution.
   */
  advance(
    ticks?: number,
    until?: number
  ): {
    ticksAdvanced: number;
    currentTime: number;
    kpis: BusinessKpis;
    envMultipliers: EnvMultipliers;
  } {
    const maxTicks = ticks ?? 1;
    let advanced = 0;

    for (let i = 0; i < maxTicks; i++) {
      if (until !== undefined && this.clock.now >= until) break;

      this.clock.advance(this.tickSeconds);
      const time = this.clock.now;

      // Base tuning merged with named disturbances.
      let tuning = computeTuningAt(this.baseTuning, this.disturbances, time);

      // Merge in environment-condition multipliers.
      const env = computeEnvMultipliers(this.conditions, time);
      tuning.trafficLevel = Math.round(tuning.trafficLevel * env.trafficScale);
      tuning.capacityMultiplier.cache =
        (tuning.capacityMultiplier.cache ?? 1) * env.cacheCapacityScale;
      tuning.capacityMultiplier.database =
        (tuning.capacityMultiplier.database ?? 1) * env.dbCapacityScale;
      tuning.capacityMultiplier.queue =
        (tuning.capacityMultiplier.queue ?? 1) * env.queueCapacityScale;
      tuning.capacityMultiplier["api-gateway"] =
        (tuning.capacityMultiplier["api-gateway"] ?? 1) * env.gatewayCapacityScale;
      tuning.latencyModifier.payment =
        (tuning.latencyModifier.payment ?? 0) + env.paymentLatencyMs;
      tuning.latencyModifier.database =
        (tuning.latencyModifier.database ?? 0) + env.databaseLatencyMs;
      tuning.latencyModifier["api-gateway"] =
        (tuning.latencyModifier["api-gateway"] ?? 0) + env.gatewayLatencyMs;

      tick(this.world, tuning, this.tickSeconds, (type, componentId, data) => {
        this.emit(type, componentId, data);
      });
      advanced++;
    }

    return {
      ticksAdvanced: advanced,
      currentTime: this.clock.now,
      kpis: observeKpis(this.world),
      envMultipliers: computeEnvMultipliers(this.conditions, this.clock.now),
    };
  }

  /** Current observability (metrics + KPIs + logs + events). */
  observe(): {
    metrics: MetricSeries[];
    kpis: BusinessKpis;
    logs: ObservableLog[];
    events: ObservableEvent[];
    worldVersion: number;
  } {
    return {
      metrics: observeMetrics(this.world),
      kpis: observeKpis(this.world),
      logs: this.logs(),
      events: [...this.events],
      worldVersion: this.world.version,
    };
  }

  /** Is the execution world still plausible given constraints? */
  validate(): { ok: boolean; violations: ReturnType<typeof validateWorld> } {
    const violations = validateWorld(this.world);
    return { ok: violations.length === 0, violations };
  }

  /** Prediction world: simulate an action on an isolated clone. */
  predict(action: Action, overrides?: Partial<BranchOptions>): PredictionResult {
    return branchToPredict({
      world: this.world,
      baseTuning: this.baseTuning,
      disturbances: this.disturbances,
      action,
      actionTime: this.clock.now,
      ...overrides,
    });
  }

  private emit(type: string, componentId: string, data: Record<string, unknown>): void {
    this.events.push({ time: this.clock.now, type, componentId, data });
  }

  private logs(): ObservableLog[] {
    return this.events.map(eventToLog);
  }
}

export { healthyTuning };
