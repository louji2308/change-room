import type { Disturbance, BusinessKpis } from "@change-room/simulator";

export type Difficulty = "easy" | "medium" | "hard";

/**
 * A named, reproducible operational problem. Everything needed to replay the
 * scenario deterministically on demand. The list of disturbances (and the seed)
 * are the *hidden* ground truth — never exposed via the agent-facing surface.
 */
export interface ScenarioDefinition {
  /** Internal unique id (e.g. "cache-failure"). */
  id: string;
  /** Human name for operators/admins (not shown to the agent in blind mode). */
  name: string;
  /** Short description of the observable symptom set. */
  description: string;
  /** Seed driving every stochastic choice — full reproducibility. */
  seed: number;
  /** Difficulty rating used for evaluation, not for the agent. */
  difficulty: Difficulty;
  /** The hidden perturbations that cause the incident. Ground truth. */
  disturbances: Disturbance[];
  /** The *expected-symptom* guides an evaluator uses (not the agent). */
  expectedSymptoms: string[];
  /** Actions/settings an operator is expected to apply to resolve it. */
  expectedRecovery: string[];
}

/**
 * The secret, admin-only truth about a running or completed scenario.
 * NEVER serialized into the agent-facing observation payload.
 */
export interface GroundTruth {
  scenarioId: string;
  name: string;
  seed: number;
  disturbances: Disturbance[];
  difficulty: Difficulty;
  expectedSymptoms: string[];
  expectedRecovery: string[];
}

/**
 * The agent-facing observation surface. Contains ONLY what a real operator
 * could see through dashboards/logs — no seed, no scenario id, no cause.
 */
export interface AgentView {
  timestamp: number;
  kpis: BusinessKpis;
  metrics: Array<Record<string, unknown>>;
  logs: Array<Record<string, unknown>>;
  health: "healthy" | "degraded" | "down";
  blind: true;
}

/**
 * Safe session metadata surfaced to any caller. Deliberately carries NO ground
 * truth (no seed, no disturbances, no reversible scenario id) — the hidden
 * cause is only reachable through the admin-gated `groundTruth()` method.
 */
export interface ScenarioSession {
  scenarioId: string;
  startedAt: number;
  steps: number;
}

export type Mode = "blind" | "admin";
