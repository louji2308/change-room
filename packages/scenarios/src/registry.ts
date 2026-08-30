import type { Disturbance } from "@change-room/simulator";
import type { Difficulty, FailureKind, ScenarioDefinition } from "./types.js";

function dist(
  type: Disturbance["type"],
  magnitude: number,
  description: string,
  start = 60,
  ramp = 30,
  duration = 0
): Disturbance {
  return { id: `dist_${type}`, type, magnitude, start, ramp, duration, description };
}

/**
 * Named, reproducible operational problems. Each scenario is a *composition of
 * constrained disturbance primitives*. Consequence (symptom) sets emerge when
 * the causal engine runs them against the world — they are NOT hardcoded here.
 *
 * Phase 16 suite: 16.1 singles below, 16.2 cascade, 16.3 misleading evidence,
 * 16.4 compound. 16.5 (concurrent) / 16.6 (stale-plan) are intentionally absent —
 * they await Phase 14 (implemented in parallel) and are only type-declared.
 */
export const SCENARIOS: ScenarioDefinition[] = [
  // ============================ 16.1 — SINGLE FAILURES ============================
  {
    id: "cache-failure",
    name: "Cache Slowdown",
    description: "Cache effective capacity collapses, pushing read traffic onto the database.",
    seed: 101,
    difficulty: "easy",
    kind: "single",
    disturbances: [
      dist("cache_degradation", 0.5, "cache effective capacity drops to 50%"),
    ],
    expectedSymptoms: [
      "cache hit rate estimate falls sharply",
      "checkout latency rises as cache misses hit the database",
      "database utilization grows",
    ],
    expectedRecovery: ["increase_cache_capacity", "restart_cache"],
  },
  {
    id: "traffic-surge",
    name: "Traffic Surge",
    description: "A marketing event drives a sharp, sustained traffic increase.",
    seed: 202,
    difficulty: "easy",
    kind: "single",
    disturbances: [
      dist("traffic_spike", 2.6, "traffic grows to 160% above baseline"),
    ],
    expectedSymptoms: [
      "checkout latency grows under higher load",
      "multiple components approach saturation",
      "error rate climbs as capacity is exceeded",
    ],
    expectedRecovery: ["scale_service", "scale_database"],
  },
  {
    id: "database-saturation",
    name: "Database Saturation",
    description: "The database connection pool regresses while contention builds, and the read spill from cache misses saturates whatever pool remains.",
    seed: 303,
    difficulty: "medium",
    kind: "single",
    disturbances: [
      dist("database_contention", 0.5, "database connection pool reduced to 50%"),
      dist("traffic_spike", 1.5, "incident-time load grows to 50% above baseline", 60, 25),
      dist("configuration_regression", 0.6, "configuration drift further reduces the pool to 60%", 80, 25),
    ],
    expectedSymptoms: [
      "database utilization saturates",
      "checkout latency climbs and errors appear",
      "downstream orders stall",
    ],
    expectedRecovery: ["scale_database", "scale_service"],
  },
  {
    id: "bad-deployment",
    name: "Bad Deployment",
    description: "A release creates memory pressure on the gateway while a dependency slows, under peak incident-time load.",
    seed: 404,
    difficulty: "medium",
    kind: "single",
    disturbances: [
      dist("deployment_memory", 2.2, "deployment creates memory pressure 220% on the gateway"),
      dist("traffic_spike", 1.2, "incident-time load grows to 20% above baseline", 60, 25),
      dist("dependency_latency", 450, "payment dependency adds 450ms latency", 80, 25),
    ],
    expectedSymptoms: [
      "api-gateway latency and errors rise",
      "checkout affected by a slow dependency",
      "system health degrades",
    ],
    expectedRecovery: ["rollback_deployment", "scale_service"],
  },
  {
    id: "queue-backlog",
    name: "Queue Backlog",
    description: "Background queue capacity shrinks under a mild surge, piling up work.",
    seed: 505,
    difficulty: "hard",
    kind: "single",
    disturbances: [
      dist("queue_backlog", 0.4, "background queue capacity drops to 40%"),
      dist("traffic_spike", 1.6, "traffic grows to 60% above baseline", 85, 30),
    ],
    expectedSymptoms: [
      "queue backs up and saps concurrency",
      "checkout latency climbs from buildup",
      "error rate rises as queues overflow",
    ],
    expectedRecovery: ["scale_service", "change_configuration"],
  },
  {
    id: "configuration-regression",
    name: "Configuration Regression",
    description: "Silent config drift weakens the database while a dependency slows — no single obvious event.",
    seed: 606,
    difficulty: "hard",
    kind: "single",
    disturbances: [
      dist("configuration_regression", 0.4, "configuration drift reduces pool to 40%"),
      dist("traffic_spike", 1.3, "incident-time load grows to 30% above baseline", 80, 25),
      dist("dependency_latency", 350, "payment dependency adds 350ms latency", 75, 25),
    ],
    expectedSymptoms: [
      "only indirect symptoms, no single obvious event",
      "database pressure builds gradually",
      "checkout latency creeps upward",
    ],
    expectedRecovery: ["restore_configuration", "scale_service"],
  },

  // ============================ 16.2 — CASCADING FAILURE ============================
  {
    id: "cascade-cache-db-checkout",
    name: "Cascading Cache → Database → Checkout Failure",
    description:
      "A single root cause at the cache propagates: cache collapse spills reads onto the database, and a regressing database pool backs that load up into checkout — components fail in sequence, not simultaneously.",
    seed: 707,
    difficulty: "hard",
    kind: "cascade",
    disturbances: [
      dist("cache_degradation", 0.55, "root cause: cache effective capacity drops to 55%", 60, 20),
      dist("database_contention", 0.8, "secondary: database pool regresses as spill-over load mounts", 90, 20),
    ],
    expectedSymptoms: [
      "the chain starts at the cache and propagates database → checkout",
      "components degrade in sequence rather than all at once",
      "remediating only the tail symptom (database) does NOT fully recover the system",
    ],
    expectedRecovery: ["increase_cache_capacity", "restart_cache", "scale_database"],
  },

  // ============================ 16.3 — MISLEADING EVIDENCE ============================
  {
    id: "misleading-deployment",
    name: "Misleading Deployment Evidence",
    description:
      "A deployment was shipped moments before the incident — but it is NOT the cause. Cache degradation is. Tests correlation vs causation: cheap reasoning blames the recent deploy; correct reasoning follows the real signal.",
    seed: 808,
    difficulty: "hard",
    kind: "misleading",
    disturbances: [
      dist("cache_degradation", 0.5, "true root cause: cache effective capacity drops to 50%", 60, 25),
    ],
    expectedSymptoms: [
      "a deployment is visible and timed exactly with the incident start — yet it is NOT the cause",
      "checkout degrades while cache hit rate collapses",
      "gateway latency rises as a downstream effect, not from the release itself",
    ],
    expectedRecovery: ["increase_cache_capacity", "restart_cache"],
    deployments: [
      {
        version: "v2.14.0",
        deployedAt: 58,
        componentId: "api-gateway",
        notes: "release v2.14.0 rolled out to edge proxies two seconds before the first symptom",
      },
    ],
  },

  // ============================ 16.4 — COMPOUND FAILURE ============================
  {
    id: "compound-traffic-cache",
    name: "Compound Traffic Surge + Cache Degradation",
    description:
      "Two independent causes degrade checkout concurrently: a demand spike raises load while the cache simultaneously collapses. Recovering only one cause leaves the other's symptoms behind.",
    seed: 909,
    difficulty: "hard",
    kind: "compound",
    disturbances: [
      dist("traffic_spike", 1.7, "cause A: traffic grows to 70% above baseline", 60, 25),
      dist("cache_degradation", 0.55, "cause B: cache effective capacity drops to 55%", 80, 25),
    ],
    expectedSymptoms: [
      "two independent root causes degrade checkout at the same time",
      "either cause alone would already hurt the system",
      "recovering only one cause leaves the other's symptoms visible",
    ],
    expectedRecovery: ["scale_service", "increase_cache_capacity", "restart_cache"],
  },
];

const byId = new Map(SCENARIOS.map((s) => [s.id, s]));

export function getScenario(id: string): ScenarioDefinition | undefined {
  return byId.get(id);
}

export function listScenarios(): string[] {
  return SCENARIOS.map((s) => s.id);
}

/** Pick a scenario by index within the registry (round-robins are fine). */
export function scenarioByIndex(index: number): ScenarioDefinition {
  return SCENARIOS[index % SCENARIOS.length];
}

/** Human cause label per disturbance type, aligned with the agent's hypothesis vocabulary. */
export type CauseLabel =
  | "traffic anomaly"
  | "cache degradation"
  | "database saturation"
  | "dependency latency"
  | "bad deployment"
  | "queue backlog"
  | "configuration regression";

export function causeLabelOf(type: Disturbance["type"]): CauseLabel {
  switch (type) {
    case "traffic_spike":
      return "traffic anomaly";
    case "cache_degradation":
      return "cache degradation";
    case "database_contention":
      return "database saturation";
    case "dependency_latency":
      return "dependency latency";
    case "deployment_memory":
      return "bad deployment";
    case "queue_backlog":
      return "queue backlog";
    case "configuration_regression":
      return "configuration regression";
  }
}

/** True causes of a scenario, ordered most-root-first (earliest start = root). */
export function rootCausesOf(def: ScenarioDefinition): CauseLabel[] {
  return [...def.disturbances]
    .sort((a, b) => a.start - b.start)
    .map((d) => causeLabelOf(d.type));
}

export type { Difficulty, FailureKind };