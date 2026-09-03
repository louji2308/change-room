/**
 * RealScenarioRunner — mirrors the `ScenarioRunner` surface (from
 * `@change-room/scenarios`) but operates against the REAL Medusa stack:
 * it composes `RealMedusaWorld` (live observation) + `RealFaultDriver`
 * (reversible, TTL auto-restored real faults). This is the "no fallback"
 * incident runner: start() injects a real fault, the sweeper auto-restores it
 * on a TTL, and every agent-facing value comes from `observeRealSystem()`.
 *
 * WorldSource surface (agentView/health/predict/executeChange/settle/
 * popUndoFrame/rollback/session) is synchronous over the latest real snapshot,
 * exactly like `RealMedusaWorld`, so the session consumes it without change.
 * The real fault lifecycle (start/inject) is async because faults act on the
 * live stack.
 */

import { RealMedusaWorld, type WorldSource } from "./real-world";
import { RealFaultDriver, type ActiveFault, type RealFaultKind, type RealFaultSpec } from "./real-fault-driver";
import type { ActionType, PredictionResult } from "@change-room/simulator";
import type { AgentView, ScenarioSession, UndoFrame } from "@change-room/scenarios";

/** A real-stack scenario: the bounded, auto-restoring fault that constitutes
 *  the incident, plus the known recovery actions. */
export interface RealScenarioDef {
  id: string;
  name: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  fault: Omit<RealFaultSpec, "ttlMs"> & { ttlMs?: number };
  expectedRecovery: string[];
  expectedSymptoms: string[];
}

/** Safe, agent-facing metadata. The injected fault IS observable on the real
 *  stack (it is not hidden ground truth), but we still keep it in a dedicated
 *  method rather than folding it into agentView (which stays pure observation). */
export interface RealScenarioSession extends ScenarioSession {
  faultKind: RealFaultKind;
  faultActive: boolean;
  expiresInMs?: number;
}

const REAL_SCENARIOS: RealScenarioDef[] = [
  {
    id: "cache-flush",
    name: "Sustained cache wipe",
    description: "Repeated Redis FLUSHALL sinks cache retention; catalog reads go cold.",
    difficulty: "easy",
    fault: { kind: "redis_flush", ttlMs: 90000 },
    expectedSymptoms: ["cache hit rate dropped", "cache degraded"],
    expectedRecovery: ["restart_cache", "increase_cache_capacity"],
  },
  {
    id: "redis-stall",
    name: "Redis event-loop stall",
    description: "Periodic DEBUG SLEEP stalls Redis and raises catalog latency.",
    difficulty: "medium",
    fault: { kind: "redis_sleep", ttlMs: 90000, params: { sleepMs: 1500 } },
    expectedSymptoms: ["checkout latency elevated"],
    expectedRecovery: ["restart_cache"],
  },
  {
    id: "db-pool-exhaust",
    name: "Postgres connection pressure",
    description: "Held connections raise server-level connection pressure; latency and errors spike.",
    difficulty: "hard",
    fault: { kind: "postgres_pool_exhaust", ttlMs: 90000, params: { connections: 5 } },
    expectedSymptoms: ["database engaged", "errors elevated"],
    expectedRecovery: ["scale_database", "restore_configuration"],
  },
  {
    id: "http-load",
    name: "Sustained HTTP load",
    description: "Sustained traffic against the storefront raises latency.",
    difficulty: "medium",
    fault: { kind: "http_load", ttlMs: 90000, params: { url: "http://127.0.0.1:8000", perTick: 4 } },
    expectedSymptoms: ["traffic/load high", "gateway latency elevated"],
    expectedRecovery: ["scale_service"],
  },
];

export function listRealScenarios(): RealScenarioDef[] {
  return REAL_SCENARIOS.map((s) => ({ ...s, fault: { ...s.fault } }));
}

export function getRealScenario(id: string): RealScenarioDef | undefined {
  return REAL_SCENARIOS.find((s) => s.id === id);
}

export interface RealScenarioRunnerOptions {
  scenarioId?: string;
  world?: RealMedusaWorld;
  faultDriver?: RealFaultDriver;
}

/**
 * Real-stack scenario runner. `setup()` seeds a live world + fault driver;
 * `start()` injects the scenario's real fault (bounded, auto-restored); the
 * WorldSource surface is served by the underlying `RealMedusaWorld`.
 */
export class RealScenarioRunner implements WorldSource {
  private readonly def: RealScenarioDef;
  private readonly world: RealMedusaWorld;
  private readonly driver: RealFaultDriver;
  private startedAt = Date.now();
  private activeFaultId: string | null = null;

  private constructor(def: RealScenarioDef, world: RealMedusaWorld, driver: RealFaultDriver) {
    this.def = def;
    this.world = world;
    this.driver = driver;
  }

  /** Validate the scenario id and bind a live world + fault driver. */
  static setup(id: string, opts: RealScenarioRunnerOptions = {}): RealScenarioRunner {
    const def = getRealScenario(id);
    if (!def) throw new Error(`unknown real scenario: ${id}`);
    const world = opts.world ?? new RealMedusaWorld();
    const driver = opts.faultDriver ?? new RealFaultDriver();
    const runner = new RealScenarioRunner(def, world, driver);
    runner.startedAt = Date.now();
    return runner;
  }

  /** Inject the scenario's real fault (bounded, TTL auto-restore). */
  start(): void {
    if (this.activeFaultId) return;
    const { ttlMs, ...rest } = this.def.fault;
    const fault: RealFaultSpec = { ...rest, ttlMs: ttlMs ?? 90000 };
    this.activeFaultId = this.driver.inject(fault).id;
    this.driver.start();
  }

  /** Async refresh of the real telemetry snapshot (live path). */
  async refresh(): Promise<void> {
    await this.world.refresh?.();
  }

  /** Expire (auto-restore) the injected fault early. */
  expire(): void {
    if (this.activeFaultId) {
      this.driver.expire(this.activeFaultId);
      this.activeFaultId = null;
    }
  }
  /** @deprecated Use expire() instead. */
  reset(): void { this.expire(); }

  /** Stop the driver entirely (graceful final sweep). */
  shutdown(): void {
    this.driver.stop();
  }

  /** Active real faults (introspection; the app exposes severity only). */
  faults(): ActiveFault[] {
    return this.driver.list();
  }

  /** Audit view of what IS happening on the real stack (not hidden here —
   *  the injected fault is genuinely observable). */
  groundTruth(): { scenarioId: string; faultKind: RealFaultKind; expectedRecovery: string[]; expectedSymptoms: string[] } {
    return {
      scenarioId: this.def.id,
      faultKind: this.def.fault.kind,
      expectedRecovery: [...this.def.expectedRecovery],
      expectedSymptoms: [...this.def.expectedSymptoms],
    };
  }

  /** Score the operator's actions against the expected real recovery path.
   *  Weights actual health recovery (60%) over action-name matching (40%) so a
   *  genuinely recovered stack scores well even if the action names don't line
   *  up with the catalog, and a still-degraded stack cannot score full marks
   *  purely on action names. */
  evaluate(agentActions: Array<{ kind: string }>): { resolved: boolean; score: number; recoveryHits: string[]; session: ScenarioSession } {
    const expected = this.def.expectedRecovery;
    const norm = (k: string) => k.trim().toLowerCase();
    const recoveryHits = expected.filter((e) => agentActions.some((a) => norm(a.kind) === norm(e)));
    // Weight: 60% actual health recovery + 40% action-name matching
    const healthScore = this.health() === "healthy" ? 60 : this.health() === "degraded" ? 20 : 0;
    const actionScore = expected.length > 0 ? (recoveryHits.length / expected.length) * 40 : 0;
    const score = Math.round(healthScore + actionScore);
    return { resolved: this.health() === "healthy", score, recoveryHits, session: this.session() };
  }

  /** Actions the real stack can actually execute (subset of all ActionType). */
  supportedActionTypes(): string[] {
    return ["clear_cache", "restart_cache", "do_nothing"];
  }

  // ---- WorldSource surface (sync over the latest real snapshot) ----

  agentView(): AgentView {
    return this.world.agentView();
  }
  health(): "healthy" | "degraded" | "down" {
    return this.world.health();
  }
  predict(action: unknown, _overrides?: unknown): PredictionResult {
    return this.world.predict(action);
  }
  async executeChange(actionType: ActionType, parameters?: Record<string, number | string>, opts?: { neutralizeDisturbances?: boolean }): Promise<{ ok: boolean; unmet: string[]; health: "healthy" | "degraded" | "down" }> {
    return this.world.executeChange(actionType, parameters, opts);
  }
  settle(seconds?: number): void {
    this.world.settle(seconds);
  }
  popUndoFrame(): UndoFrame | undefined {
    return this.world.popUndoFrame() as UndoFrame | undefined;
  }
  async rollback(): Promise<{ ok: boolean; unmet: string[]; health: "healthy" | "degraded" | "down" }> {
    return this.world.rollback();
  }
  session(): RealScenarioSession {
    const base = this.world.session();
    const fault = this.activeFaultId ? this.driver.list().find((f) => f.id === this.activeFaultId) : undefined;
    return {
      ...base,
      faultKind: this.def.fault.kind,
      faultActive: !!fault,
      expiresInMs: fault ? Math.max(0, fault.expiresAt - Date.now()) : undefined,
      startedAt: this.startedAt,
    };
  }
}
