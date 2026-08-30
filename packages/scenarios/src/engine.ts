import {
  WorldSimulator,
  type Disturbance,
  type MetricSeries,
  type ActionType,
  createAction,
  applyAction,
  computeTuningAt,
  branchToPredict,
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

interface UndoFrame {
  trafficLevel: number;
  capacityMultiplier: Record<string, number>;
  latencyModifier: Record<string, number>;
  disturbances: Disturbance[];
}

export class ScenarioRunner {
  private sim: WorldSimulator;
  private definition;
  private startedAt = 0;
  private steps = 0;
  /** Deque of executed changes so `rollback()` can faithfully revert the last one. */
  private undoStack: UndoFrame[] = [];

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
      disturbances: structuredClone(def.disturbances) as Disturbance[],
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

  /**
   * Prediction that mirrors `executeChange`'s remediation semantics: the action
   * is applied to the clean baseline and the matching disturbances are
   * dropped, then the branch simulates forward. This makes the harness's
   * prediction-accuracy metric compare like-with-like (a remediation was
   * executed, so the prediction must also model a remediation), and it gives
   * the agent's simulation tool an honest view of what its action would do.
   */
  predict(
    action: Parameters<WorldSimulator["predict"]>[0],
    overrides?: Parameters<WorldSimulator["predict"]>[1]
  ): ReturnType<WorldSimulator["predict"]> {
    const applied = applyAction(this.sim.baseTuning, action);
    if (!applied.ok) {
      return {
        ok: false,
        unmet: applied.unmet,
        finalTuning: computeTuningAt(this.sim.baseTuning, this.sim.disturbances, this.sim.clock.now),
        metrics: [],
        kpis: this.sim.observe().kpis,
        logs: [],
        events: [],
        worldVersion: this.sim.world.version,
        fingerprint: this.sim.world.fingerprint(),
      };
    }
    const remaining = this.sim.disturbances.filter(
      (d) => !disturbanceKindsFor(action.type).includes(d.type)
    );
    return branchToPredict({
      world: this.sim.world,
      baseTuning: applied.tuning,
      disturbances: remaining,
      action: createAction("do_nothing"),
      actionTime: this.sim.clock.now,
      ...overrides,
    });
  }

  /**
   * Execute an approved remediation on the LIVE execution world, inside the
   * runner so the blind surface is preserved. Mirrors `branchToPredict` but
   * commits the action to the real base tuning (and, unless disabled, also
   * neutralises the matching disturbances) so subsequent `step()` reflects it.
   *
   * The applied tuning replaces the live per-component capacity/latency maps
   * whole (deletions such as `restore_configuration` persist). Traffic level is
   * never rewritten: no action may change demand, only capacity. A snapshot of
   * the pre-change state is pushed to the undo stack so `rollback()` can
   * faithfully revert this change.
   *
   * Returns whether the action's preconditions passed and the resulting health.
   */
  executeChange(
    actionType: ActionType,
    parameters: Record<string, number | string> = {},
    opts: { neutralizeDisturbances?: boolean } = {}
  ): { ok: boolean; unmet: string[]; health: "healthy" | "degraded" | "down" } {
    const action = createAction(actionType, parameters);
    // Remediation is applied to the *clean* baseline, not to the currently
    // degraded tuning: an action adds capacity/latency relief on top of the
    // healthy baseline, then the matching disturbances are removed. Applying to
    // the degraded current would bake the degraded values into the new world
    // base (a queue stuck at 40% capacity forever) and double-degrade the
    // disturbances that legitimately remain.
    const applied = applyAction(this.sim.baseTuning, action);
    if (!applied.ok) {
      return { ok: false, unmet: applied.unmet, health: this.health() };
    }
    // Commit the new tuning as the live base (in-place to respect `readonly`).
    const base = this.sim.baseTuning;
    this.undoStack.push({
      trafficLevel: base.trafficLevel,
      capacityMultiplier: { ...base.capacityMultiplier },
      latencyModifier: { ...base.latencyModifier },
      disturbances: this.sim.disturbances.map((d) => structuredClone(d)),
    });
    base.capacityMultiplier = { ...applied.tuning.capacityMultiplier };
    base.latencyModifier = { ...applied.tuning.latencyModifier };

    if (opts.neutralizeDisturbances !== false) {
      this.neutralizeRelated(actionType);
    }
    return { ok: true, unmet: [], health: this.health() };
  }

  /**
   * Faithfully revert the last executed change: restore the pre-change base
   * tuning and the disturbance set, then report the current health. Returns
   * `ok:false` (no mutation) when there is nothing to roll back.
   */
  rollback(): { ok: boolean; unmet: string[]; health: "healthy" | "degraded" | "down" } {
    const prev = this.undoStack.pop();
    if (!prev) return { ok: false, unmet: ["no executed change to roll back"], health: this.health() };
    const base = this.sim.baseTuning;
    base.trafficLevel = prev.trafficLevel;
    base.capacityMultiplier = prev.capacityMultiplier;
    base.latencyModifier = prev.latencyModifier;
    this.sim.disturbances.length = 0;
    this.sim.disturbances.push(...prev.disturbances);
    return { ok: true, unmet: [], health: this.health() };
  }

  /** Health classified purely from observable KPIs. */
  health(): "healthy" | "degraded" | "down" {
    return this.sim.observe().kpis.systemHealth;
  }

  /**
   * The ONLY allowed agent-facing surface. Strips every hidden field: seed,
   * disturbances, scenario id, and any event that carries cause metadata.
   * Deployment metadata from the definition *is* surfaced — it is observation,
   * never a causal claim (16.3 correlation trap lives here).
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
      deployments: this.definition.deployments ?? [],
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
      kind: this.definition.kind,
      disturbances: structuredClone(this.definition.disturbances) as Disturbance[],
      difficulty: this.definition.difficulty,
      expectedSymptoms: [...this.definition.expectedSymptoms],
      expectedRecovery: [...this.definition.expectedRecovery],
      deployments: this.definition.deployments ? structuredClone(this.definition.deployments) : [],
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
    this.undoStack = [];
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

  /**
   * Remove the disturbances that an action is meant to remediate (true
   * recovery mode). Because every seeded disturbance persists forever
   * (duration 0), a remediation that only changes tuning keeps re-degrading
   * unless the matching disturbance is dropped.
   */
  private neutralizeRelated(actionType: ActionType): void {
    const toRemove: string[] = disturbanceKindsFor(actionType);
    const remaining = this.sim.disturbances.filter((d) => !toRemove.includes(d.type));
    // splice in place on the live array (the reference is readonly, contents are not).
    this.sim.disturbances.length = 0;
    this.sim.disturbances.push(...remaining);
  }
}

function disturbanceKindsFor(actionType: ActionType): string[] {
  switch (actionType) {
    case "increase_cache_capacity":
    case "restart_cache":
      return ["cache_degradation"];
    case "scale_database":
      return ["database_contention", "configuration_regression"];
    case "scale_service":
      return ["traffic_spike"];
    case "change_configuration":
      return ["queue_backlog", "configuration_regression", "database_contention"];
    case "restore_configuration":
      return ["configuration_regression", "database_contention"];
    case "rollback_deployment":
      return ["deployment_memory"];
    default:
      return [];
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