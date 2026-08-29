/**
 * Observability — derived from the live world state, never hardcoded
 * (Simulator.md §7, §29). The agent sees these observations, not simulator
 * internals or hidden ground truth.
 */

import type { WorldState } from "../world/world-state.js";
import { topologyById } from "../world/topology.js";

export interface MetricSeries {
  componentId: string;
  utilization: number;
  latencyMs: number;
  errorRate: number;
  queueDepth: number;
  degraded: boolean;
}

export interface BusinessKpis {
  checkoutLatencyMs: number;
  checkoutErrorRate: number;
  checkoutSuccessRate: number;
  ordersThroughputPerSec: number;
  cacheHitRateEstimate: number;
  systemHealth: "healthy" | "degraded" | "down";
}

/** Snapshot the primary metrics for every component. */
export function observeMetrics(world: WorldState): MetricSeries[] {
  const out: MetricSeries[] = [];
  for (const [id, c] of world.components) {
    out.push({
      componentId: id,
      utilization: Math.round(c.utilization * 10) / 10,
      latencyMs: c.latencyMs,
      errorRate: c.errorRate,
      queueDepth: Math.round(c.queueDepth),
      degraded: c.degraded,
    });
  }
  return out;
}

/**
 * Business KPIs are derived from the model, not fabricated:
 * checkout latency/error come from the checkout component; orders throughput
 * is bounded by the inherited success rate; cache hit estimate is derived from
 * cache utilization.
 */
export function observeKpis(world: WorldState): BusinessKpis {
  const checkout = world.get("checkout");
  const cache = world.get("cache");
  const orders = world.get("orders");
  const traffic = world.get("traffic");

  const checkoutLatencyMs = checkout.latencyMs;
  const checkoutErrorRate = checkout.errorRate;
  const checkoutSuccessRate = Math.max(0, 100 - checkoutErrorRate);

  const successFraction = orders.errorRate > 0 ? Math.max(0, 1 - orders.errorRate / 100) : 1;
  const ordersThroughputPerSec = Math.round(traffic.inboundLoad * 0.4 * successFraction * 10) / 10;

  const cacheUtil = cache.utilization;
  const cacheHitRateEstimate = Math.round(Math.max(20, 100 - cacheUtil * 0.9));

  let systemHealth: BusinessKpis["systemHealth"] = "healthy";
  if (checkout.errorRate > 20 || checkout.latencyMs > 800) systemHealth = "down";
  else if (checkout.errorRate > 5 || checkout.latencyMs > 350) systemHealth = "degraded";

  return {
    checkoutLatencyMs,
    checkoutErrorRate,
    checkoutSuccessRate: Math.round(checkoutSuccessRate * 10) / 10,
    ordersThroughputPerSec,
    cacheHitRateEstimate,
    systemHealth,
  };
}

export interface ObservableEvent {
  time: number;
  type: string;
  componentId: string;
  data: Record<string, unknown>;
}

export interface ObservableLog {
  time: number;
  level: "info" | "warn" | "error";
  componentId: string;
  message: string;
}

/**
 * Turn a discrete causal event into a human-style operational log entry.
 * Kept deliberately coarse — the agent investigates like an operator.
 */
export function eventToLog(ev: ObservableEvent): ObservableLog {
  let level: ObservableLog["level"] = "info";
  const util = Number(ev.data.utilization ?? 0);
  const err = Number(ev.data.errorRate ?? 0);
  const lat = Number(ev.data.latencyMs ?? 0);
  if (err > 20 || util >= 95) level = "error";
  else if (err > 5 || util >= 85) level = "warn";

  const def = topologyById(ev.componentId);
  const message = `${def.label}: utilization ${util.toFixed(1)}%, latency ${lat}ms, error ${err.toFixed(1)}%`;
  return { time: ev.time, level, componentId: ev.componentId, message };
}
