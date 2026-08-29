/**
 * Change Room — Resource definitions (Step 1.1)
 *
 * Each resource has a stable id and a deterministic default attribute set.
 * The defaults define a healthy baseline the simulator/scenarios can mutate
 * only through the transition engine.
 */

import type { ResourceAttribute, ResourceId } from "./types.js";

export interface ResourceDefinition {
  id: ResourceId;
  description: string;
  /** The healthy baseline attributes for this resource. */
  defaults: Readonly<Record<string, ResourceAttribute>>;
}

export const RESOURCE_DEFINITIONS: Readonly<Record<ResourceId, ResourceDefinition>> = {
  traffic: {
    id: "traffic",
    description: "Inbound request volume and its rate of change.",
    defaults: {
      requestsPerMinute: 1200,
      growthRate: 0,
      peak: false,
    },
  },
  service: {
    id: "service",
    description: "Overall service health and resource pressure.",
    defaults: {
      instances: 4,
      healthy: true,
      cpuUtilization: 35,
      memoryUtilization: 42,
    },
  },
  cache: {
    id: "cache",
    description: "In-memory cache capacity, hit rate and behavior.",
    defaults: {
      capacityGB: 10,
      hitRate: 95,
      evictionRate: 2,
      degraded: false,
    },
  },
  database: {
    id: "database",
    description: "Primary datastore load and health.",
    defaults: {
      connections: 40,
      utilization: 55,
      readLatencyMs: 18,
      saturated: false,
    },
  },
  queue: {
    id: "queue",
    description: "Background work queue depth and processing health.",
    defaults: {
      depth: 20,
      processingRate: 100,
      backlog: 0,
    },
  },
  deployment: {
    id: "deployment",
    description: "Last deployed release and its rollout status.",
    defaults: {
      version: "v1.0.0",
      status: "stable",
      rollbackAvailable: false,
      checksFailed: 0,
    },
  },
  configuration: {
    id: "configuration",
    description: "Runtime configuration knobs that can be changed.",
    defaults: {
      checkoutTimeoutSec: 30,
      maxInventoryBuffer: 500,
      featureFlags: "baseline",
    },
  },
  inventory: {
    id: "inventory",
    description: "Product inventory consistency and buffer.",
    defaults: {
      synced: true,
      mismatchCount: 0,
      stockBuffer: 500,
    },
  },
  checkout: {
    id: "checkout",
    description: "End-to-end checkout experience and success.",
    defaults: {
      latencyMs: 180,
      errorRate: 0.5,
      successRate: 99.2,
      degraded: false,
    },
  },
};

export function defaultResourceAttrs(id: ResourceId): Readonly<Record<string, ResourceAttribute>> {
  const def = RESOURCE_DEFINITIONS[id];
  if (!def) {
    throw new Error(`Unknown resource id: ${id}`);
  }
  return { ...def.defaults };
}

export const ALL_RESOURCE_IDS: ResourceId[] = Object.keys(RESOURCE_DEFINITIONS) as ResourceId[];
