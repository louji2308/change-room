import {
  WorldSimulator,
  type Disturbance,
  type MetricSeries,
} from "@change-room/simulator";
import type { AgentView, GroundTruth, ScenarioSession } from "./types.js";
import { getScenario } from "./registry.js";

/**
 * Blind scenario runner.
 *
 * Owns a live causal simulator for one scenario. The only thing the operator
 * (agent) may query goes through `agentView()` — a surface guaranteed to
 * contain no seed, no disturbance list/type, and no scenario id. The hidden
 * cause lives behind `groundTruth()`, which callers must gate behind an admin
 * authorization boundary. `reset()` tears down and returns to a clean baseline.
 *
 * The scenario engine *injects* through the causal disturbances (defined
 * transitions inside the simulator), never by writing arbitrary dashboard
 * values — consequences still emerge from the causal model.
 */

export class ScenarioRunner {
  private sim: WorldSimulator;
  private definition;
  private startedAt = 0;
  private steps = 0;

  private constructor(definition: NonNullable<ReturnType<typeof getScenario>>, sim: WorldSimulator) {
    this.definition = definition;
    this.sim = sim;
  }

  /** Set up a fresh causal world for `scenarioId` and run it to baseline. */
  static setup(scenarioId: string): ScenarioRunner {
    const def = getScenario(scenarioId);
    if (!def) throw new Error(`unknown scenario: ${scenarioId}`);
    const sim = new WorldSimulator({
      seed: def.seed,
      scenario: "random",
      disturbances: def.disturbances,
    });
    sim.runBaseline(60);
    const runner = new ScenarioRunner(def, sim);
    runner.startedAt = sim.clock.now;
    return runner;
  }

  /** A fresh clean baseline with no disturbances (used by reset / health compare). */
  static cleanBaseline(trafficLevel = 1500): WorldSimulator {
    const sim = new WorldSimulator({ seed: 1, scenario: "random", disturbances: [] });
    sim.runBaseline(60);
    return sim;
  }

  /** Begin the incident (disturbances apply on later steps). */
  start(): void {
    this.sim.startIncident();
  }

  /** Advance the causal model `seconds` forward. */
  step(seconds = 1): void {
    this.sim.step(seconds);
    this.steps += seconds;
  }

  /** Advance until near steady state. */
  settle(maxSeconds = 60): void {
    this.sim.settle(maxSeconds);
    this.steps += maxSeconds;
  }

  /** Health classified purely from observable KPIs. */
  health(): "healthy" | "degraded" | "down" {
    return this.sim.observe().kpis.systemHealth;
  }

  /**
   * The ONLY allowed agent-facing surface. Strips every hidden field: seed,
   * disturbances, scenario id, and any event that carries cause metadata.
   */
  agentView(): AgentView {
    const o = this.sim.observe();
    const safeLogs = o.events
      .filter((e) => !this.isCauseLeak(e.data))
      .map((e) => ({ time: e.time, type: e.type, componentId: e.componentId }));
    return {
      timestamp: this.sim.clock.now,
      kpis: o.kpis,
      metrics: o.metrics.map(redactMetric),
      logs: safeLogs,
      health: o.kpis.systemHealth,
      blind: true,
    };
  }

  /**
   * Admin-only ground truth. Callers MUST gate this behind authorization —
   * it must never reach the agent payload in blind mode.
   */
  groundTruth(): GroundTruth {
    return {
      scenarioId: this.definition.id,
      name: this.definition.name,
      seed: this.definition.seed,
      disturbances: structuredClone(this.definition.disturbances) as Disturbance[],
      difficulty: this.definition.difficulty,
      expectedSymptoms: [...this.definition.expectedSymptoms],
      expectedRecovery: [...this.definition.expectedRecovery],
    };
  }

  /**
   * Score the operator's claimed actions against the scenario's expected
   * recovery path. Deterministic, seed-independent, evaluation-only.
   */
  evaluate(agentActions: Array<{ kind: string }>): {
    resolved: boolean;
    score: number;
    recoveryHits: string[];
    session: ScenarioSession;
  } {
    const expected = this.definition.expectedRecovery;
    const recoveryHits = expected.filter((exp) =>
      agentActions.some((a) => normalize(a.kind) === normalize(exp))
    );
    const score = Math.round((recoveryHits.length / expected.length) * 100);
    const resolved = this.sim.observe().kpis.systemHealth === "healthy";
    return { resolved, score, recoveryHits, session: this.session() };
  }

  /**
   * Safe session metadata: opaque id, no cause, no seed.
   * The id is a non-reversible hash of the scenario id string — stable per
   * scenario but cannot be mapped back to the seed or the cause.
   */
  session(): ScenarioSession {
    return {
      scenarioId: `scenario-${scenarioHash(this.definition.id)}`,
      startedAt: this.startedAt,
      steps: this.steps,
    };
  }

  /**
   * Tear down and rebuild a clean baseline (no disturbances).
   * Returns nothing: a fresh, blind `WorldSimulator` is retained privately,
   * so no ground-truth-bearing object (.seed, .disturbances) is handed back.
   */
  reset(): void {
    const traffic = this.sim.baseTuning.trafficLevel;
    this.sim = ScenarioRunner.cleanBaseline(traffic);
    this.steps = 0;
    this.startedAt = 0;
  }

  /** Internal: does an event data blob carry hidden cause fields? */
  private isCauseLeak(data: Record<string, unknown>): boolean {
    return (
      data.seed !== undefined ||
      data.disturbances !== undefined ||
      data.cause !== undefined ||
      data.scenario !== undefined
    );
  }
}

function normalize(kind: string): string {
  return kind.trim().toLowerCase();
}

/**
 * Non-reversible, deterministic string hash (FNV-1a) over a scenario id.
 * Used to derive an opaque session id so the seed is never encoded. Stable for
 * a given id, but cannot be reversed back to any ground-truth value.
 */
function scenarioHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function redactMetric(m: MetricSeries): Record<string, unknown> {
  return {
    componentId: m.componentId,
    utilization: m.utilization,
    latencyMs: m.latencyMs,
    errorRate: m.errorRate,
    queueDepth: m.queueDepth,
    degraded: m.degraded,
  };
}
