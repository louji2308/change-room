/**
 * Causal engine — propagates system state one simulated tick.
 *
 * Each tick:
 *  1. routes inbound load through the dependency graph from traffic,
 *  2. computes utilization, latency, queue depth and error rate per component
 *     from the causal rules (threshold + saturation curves),
 *  3. models the *cache miss -> database hit* dynamic (Simulator.md §15):
 *     when the cache is under pressure its effective hit rate drops and more
 *     requests flow through to the database, which raises DB load and, through
 *     dependency latency, checkout latency,
 *  4. propagates latency and errors upstream (end-to-end),
 *  5. enforces constraints and bumps the world version.
 */

import { latencyOf, errorRateOf, updateQueueDepth, utilizationOf, backpressureMultiplier, clamp } from "./rules.js";
import { downstreamIds, upstreamOf, topologyById } from "../world/topology.js";
import { effectiveCapacity, effectiveServiceTime } from "../world/tuning.js";
import type { WorldState } from "../world/world-state.js";
import type { WorldTuning } from "../world/tuning.js";

export type EventFn = (type: string, componentId: string, data: Record<string, unknown>) => void;

/**
 * Routing: fraction of a component's load forwarded to each downstream edge.
 * Weights per source sum to 1.0 (except cache -> database, which is scaled by
 * the cache miss ratio at runtime).
 */
const ROUTING: Record<string, Record<string, number>> = {
  "api-gateway": { checkout: 0.55, search: 0.45 },
  checkout: { cache: 0.4, queue: 0.2, inventory: 0.25, payment: 0.15 },
  search: { cache: 1.0 },
  cache: { database: 1.0 },
  inventory: { products: 1.0 },
  queue: { database: 1.0 },
  database: { orders: 1.0 },
};

function fractionOf(sourceId: string, nextId: string): number {
  const table = ROUTING[sourceId];
  if (!table) return 1.0;
  return table[nextId] ?? 0;
}

/**
 * Cache effective miss ratio, rising with cache utilization. Below low load a
 * component services most requests from cache; as it saturates the miss ratio
 * climbs so more requests spill to the database.
 */
export function cacheMissRatio(util: number): number {
  if (util <= 30) return 0.1;
  if (util >= 90) return 0.8;
  const p = (util - 30) / 60;
  return 0.1 + 0.7 * p * p;
}

/**
 * The fraction of a component's forward flow that actually passes to a given
 * downstream edge. Only cache -> database is attenuated by cache misses; all
 * other edges pass their full share.
 */
function forwardFraction(sourceId: string, nextId: string, world: WorldState): number {
  if (sourceId === "cache" && nextId === "database") {
    return cacheMissRatio(world.get("cache").utilization);
  }
  return fractionOf(sourceId, nextId);
}

export interface TickResult {
  version: number;
  changed: boolean;
}

/**
 * Run one simulation step of `tickSeconds` over the world.
 * `tuning` carries the current perturbable parameters (traffic level,
 * capacity multipliers, latency modifiers) set by the world/disturbance layer.
 */
export function tick(
  world: WorldState,
  tuning: WorldTuning,
  tickSeconds: number,
  emit?: EventFn
): TickResult {
  const before = world.fingerprint();

  const trafficLevel = tuning.trafficLevel;
  if (trafficLevel < 0) throw new Error("trafficLevel cannot be negative");

  // 1) Set the root load from traffic.
  world.get("traffic").inboundLoad = trafficLevel;

  // 2) Load propagation. First relaxation uses routing fractions only; then we
  //    recompute using cache-miss-attenuated forwarding once cache util known.
  const propagate = () => {
    for (const [id] of world.components) {
      if (id === "traffic") continue;
      let inbound = 0;
      for (const up of upstreamOf(id)) {
        inbound += world.get(up).inboundLoad * forwardFraction(up, id, world);
      }
      world.get(id).inboundLoad = inbound;
    }
    // refresh utilization so cache miss ratio reflects the new load
    for (const [id, component] of world.components) {
      const def = topologyById(id);
      const cap = effectiveCapacity(def.capacity, tuning, id);
      component.utilization = utilizationOf(component.inboundLoad, cap);
    }
  };

  propagate();
  propagate();
  // Recompute once more after cache util has updated (stable fixpoint).
  propagate();

  const latency: Record<string, number> = {};
  const error: Record<string, number> = {};

  // 3) Utilization is already computed during propagation.

  // 4) Latency & error, including downstream contribution (end-to-end).
  for (let pass = 0; pass < 2; pass++) {
    for (const [id, component] of world.components) {
      const def = topologyById(id);
      const cap = effectiveCapacity(def.capacity, tuning, id);
      const serviceTime = effectiveServiceTime(def.serviceTimeMs, tuning, id);
      const util = component.utilization;
      const thr = { latencyThreshold: def.latencyThreshold, saturationPoint: def.saturationPoint, serviceTimeMs: serviceTime };
      const ownLatency = latencyOf(util, thr);
      const ownError = errorRateOf(util, thr);

      let waitMs = 0;
      let waitWeight = 0;
      for (const d of downstreamIds(id)) {
        const dDef = topologyById(d);
        const dCap = effectiveCapacity(dDef.capacity, tuning, d);
        const dService = effectiveServiceTime(dDef.serviceTimeMs, tuning, d);
        const dThr = { latencyThreshold: dDef.latencyThreshold, saturationPoint: dDef.saturationPoint, serviceTimeMs: dService };
        const dLat = latency[d] ?? latencyOf(world.get(d).utilization, dThr);
        const f = fractionOf(id, d);
        waitMs += dLat * f;
        waitWeight += f;
      }
      const downstreamWait = waitWeight > 0 ? waitMs / waitWeight : 0;

      let depErr = 0;
      let depErrWeight = 0;
      for (const d of downstreamIds(id)) {
        const dDef = topologyById(d);
        const dService = effectiveServiceTime(dDef.serviceTimeMs, tuning, d);
        const dThr = { latencyThreshold: dDef.latencyThreshold, saturationPoint: dDef.saturationPoint, serviceTimeMs: dService };
        const dErr = error[d] ?? errorRateOf(world.get(d).utilization, dThr);
        const f = fractionOf(id, d);
        depErr += dErr * f;
        depErrWeight += f;
      }
      const downstreamErr = depErrWeight > 0 ? depErr / depErrWeight : 0;

      const combinedError = Math.max(ownError, downstreamErr);
      const bp = backpressureMultiplier(combinedError);
      const totalLatency = (ownLatency + downstreamWait) * bp;

      latency[id] = totalLatency;
      error[id] = combinedError;

      const prevQueue = component.queueDepth;
      const prevDegraded = component.degraded;
      const newQueue = updateQueueDepth(component.queueDepth, component.inboundLoad, cap, tickSeconds);
      component.queueDepth = newQueue;
      component.latencyMs = Math.round(totalLatency);
      component.errorRate = Math.round(clamp(combinedError, 0, 100) * 10) / 10;
      component.degraded = component.errorRate > 5 || component.utilization >= def.saturationPoint;

      if (emit && (component.degraded !== prevDegraded || newQueue !== prevQueue)) {
        emit("metric_updated", id, {
          utilization: component.utilization,
          latencyMs: component.latencyMs,
          errorRate: component.errorRate,
          queueDepth: component.queueDepth,
          degraded: component.degraded,
        });
      }
    }
  }

  // 5) Version bump + return change indicator.
  world.version += 1;
  const after = world.fingerprint();
  return { version: world.version, changed: before !== after };
}
