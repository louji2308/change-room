import type { Disturbance } from "@change-room/simulator";
import type { Difficulty, ScenarioDefinition } from "./types.js";

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
 */
export const SCENARIOS: ScenarioDefinition[] = [
  {
    id: "cache-failure",
    name: "Cache Slowdown",
    description: "Cache effective capacity collapses, pushing read traffic onto the database.",
    seed: 101,
    difficulty: "easy",
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
    description: "The database connection pool regresses while contention builds.",
    seed: 303,
    difficulty: "medium",
    disturbances: [
      dist("database_contention", 0.6, "database connection pool reduced to 60%"),
      dist("configuration_regression", 0.7, "configuration drift reduces pool to 70%", 95, 25),
    ],
    expectedSymptoms: [
      "database utilization saturates",
      "checkout latency climbs and errors appear",
      "downstream orders stall",
    ],
    expectedRecovery: ["scale_database", "restore_configuration"],
  },
  {
    id: "bad-deployment",
    name: "Bad Deployment",
    description: "A deploy creates memory pressure while a dependency slows.",
    seed: 404,
    difficulty: "medium",
    disturbances: [
      dist("deployment_memory", 2.2, "deployment creates memory pressure 220% on the gateway"),
      dist("dependency_latency", 250, "payment dependency adds 250ms latency", 90, 25),
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
    description: "Silent config drift weakens the database while a dependency slows.",
    seed: 606,
    difficulty: "hard",
    disturbances: [
      dist("configuration_regression", 0.7, "configuration drift reduces pool to 70%"),
      dist("dependency_latency", 140, "payment dependency adds 140ms latency", 100, 30),
    ],
    expectedSymptoms: [
      "only indirect symptoms, no single obvious event",
      "database pressure builds gradually",
      "checkout latency creeps upward",
    ],
    expectedRecovery: ["restore_configuration", "rollback_deployment"],
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
