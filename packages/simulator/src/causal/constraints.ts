/**
 * Constraint engine — prevents impossible world states (Simulator.md §11, §24).
 * The generator and disturbance injector run worlds through this so the
 * simulator never produces "fake numbers".
 */

import { clamp } from "./rules.js";
import { topologyById } from "../world/topology.js";
import type { WorldState } from "../world/world-state.js";

export interface ConstraintViolation {
  componentId: string;
  message: string;
}

/**
 * Validate a world against physical constraints. Returns a list of violations.
 * Empty list = plausible world.
 */
export function validateWorld(world: WorldState): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  for (const [id, c] of world.components) {
    const def = topologyById(id);
    if (c.utilization < 0 || c.utilization > 100) {
      violations.push({ componentId: id, message: `utilization ${c.utilization} out of [0,100]` });
    }
    if (c.queueDepth < 0) {
      violations.push({ componentId: id, message: `negative queueDepth ${c.queueDepth}` });
    }
    if (c.inboundLoad < 0) {
      violations.push({ componentId: id, message: `negative inboundLoad ${c.inboundLoad}` });
    }
    if (c.latencyMs < def.serviceTimeMs && c.inboundLoad > 0) {
      // A component that is doing work cannot serve faster than its idle time.
      violations.push({ componentId: id, message: `latency ${c.latencyMs} below idle service time ${def.serviceTimeMs}` });
    }
  }
  return violations;
}

/**
 * Repair a world in-place so it satisfies hard constraints (clamping).
 */
export function repairWorld(world: WorldState): void {
  for (const [id, c] of world.components) {
    const def = topologyById(id);
    c.utilization = clamp(c.utilization, 0, 100);
    c.queueDepth = clamp(c.queueDepth, 0, Number.MAX_SAFE_INTEGER);
    c.inboundLoad = clamp(c.inboundLoad, 0, def.capacity * 5);
    c.errorRate = clamp(c.errorRate, 0, 100);
  }
}
