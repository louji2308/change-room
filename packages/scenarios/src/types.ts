import type { Disturbance, BusinessKpis } from "@change-room/simulator";

export type Difficulty = "easy" | "medium" | "hard";

/**
 * Failure taxonomy of a scenario (Idea.md §46 SCENARIO DIFFICULTY).
 *
 * 16.5 (concurrent) and 16.6 (stale-plan) are NOT built yet — they depend on
 * Phase 14 which is being implemented in parallel. The union is declared now so
 * the registry and evaluation tooling are already type-ready for them.
 */
export type FailureKind =
  | "single"
  | "cascade"
  | "misleading"
  | "compound"
  | "concurrent"
  | "stale-plan";

/**
 * Operator-visible deployment metadata (evidence, NOT ground truth).
 *
 * This is what a real operator would see in a deploy dashboard. It is *agent
 * facing* on purpose: phase 16.3 "misleading evidence" scenarios seed a recent
 * deployment record here that must NOT be the root cause. The record itself is
 * harmless observation — the hidden cause always lives in `disturbances`.
 */
export interface DeploymentRecord {
  version: string;
  /** Sim-seconds when the deployment was shipped. */
  deployedAt: number;
  componentId: string;
  /** Safe, cause-free notes (never carries a disturbance type / seed). */
  notes: string;
}

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
  /** Failure taxonomy (Idea.md §46). */
  kind: FailureKind;
  /** The hidden perturbations that cause the incident. Ground truth. */
  disturbances: Disturbance[];
  /** The *expected-symptom* guides an evaluator uses (not the agent). */
  expectedSymptoms: string[];
  /** Actions/settings an operator is expected to apply to resolve it. */
  expectedRecovery: string[];
  /** Agent-visible deployment metadata (16.3 correlational red herring). */
  deployments?: DeploymentRecord[];
}

/**
 * The secret, admin-only truth about a running or completed scenario.
 * NEVER serialized into the agent-facing observation payload.
 */
export interface GroundTruth {
  scenarioId: string;
  name: string;
  seed: number;
  kind: FailureKind;
  disturbances: Disturbance[];
  difficulty: Difficulty;
  expectedSymptoms: string[];
  expectedRecovery: string[];
  deployments: DeploymentRecord[];
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
  /** Recent deployment metadata (observation, never a causal claim). */
  deployments: DeploymentRecord[];
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