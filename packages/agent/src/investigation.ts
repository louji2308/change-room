/**
 * Investigation engine (Implementation.md §6.2; Idea.md §18).
 *
 * The agent inspects the observable system view and collects structured
 * evidence with source, timestamp, relevance, trust and uncertainty. It never
 * sees the scenario's hidden seed/disturbances/cause — only what an operator
 * could observe.
 */

import type { Evidence, ComponentObservation, KpiObservation, LogObservation, SystemObservation } from "@change-room/domain";
import type { AgentView } from "@change-room/scenarios";

export interface InvestigationResult {
  observation: SystemObservation;
  /** Collected evidence, each tied to a specific observable. */
  evidence: Evidence[];
}

/** Normalize a (possibly redacted) metric row into a ComponentObservation. */
function toComponent(row: Record<string, unknown>): ComponentObservation | null {
  if (typeof row.componentId !== "string") return null;
  return {
    componentId: row.componentId,
    utilization: Number(row.utilization ?? 0),
    latencyMs: Number(row.latencyMs ?? 0),
    errorRate: Number(row.errorRate ?? 0),
    queueDepth: Number(row.queueDepth ?? 0),
    degraded: Boolean(row.degraded),
  };
}

/**
 * Investigate the current observable view, deriving system components, logs and
 * a well-shaped evidence set. Evidence is derived deterministically from the
 * observation — never invented.
 */
export function investigate(view: AgentView, stateVersion: number): InvestigationResult {
  const components: ComponentObservation[] = view.metrics
    .map(toComponent)
    .filter((c): c is ComponentObservation => c !== null);
  const logs: LogObservation[] = view.logs.map((l) => ({
    time: Number(l.time ?? 0),
    level: (l.level as LogObservation["level"]) ?? "info",
    componentId: String(l.componentId ?? "system"),
    message: String(l.message ?? ""),
  }));
  const kpis: KpiObservation = {
    checkoutLatencyMs: Number(view.kpis.checkoutLatencyMs ?? 0),
    checkoutErrorRate: Number(view.kpis.checkoutErrorRate ?? 0),
    checkoutSuccessRate: Number(view.kpis.checkoutSuccessRate ?? 0),
    ordersThroughputPerSec: Number(view.kpis.ordersThroughputPerSec ?? 0),
    cacheHitRateEstimate: Number(view.kpis.cacheHitRateEstimate ?? 0),
    systemHealth: view.kpis.systemHealth,
  };
  const observation: SystemObservation = {
    timestamp: Number(view.timestamp ?? 0),
    kpis,
    components,
    logs,
    health: view.health,
    stateVersion,
  };

  const evidence: Evidence[] = [];
  let n = 0;
  const push = (label: string, metric: string, value: number | string, source: string, relevance: number) => {
    evidence.push({
      id: `ev_${n++}`,
      label,
      metric,
      value,
      source,
      timestamp: observation.timestamp,
      relevance,
      trust: "trusted-system",
      uncertainty: 0.1,
    });
  };

  push("Checkout latency", "checkoutLatencyMs", kpis.checkoutLatencyMs, "business-kpi", 1);
  push("Checkout error rate", "checkoutErrorRate", kpis.checkoutErrorRate, "business-kpi", 1);
  push("Checkout success rate", "checkoutSuccessRate", kpis.checkoutSuccessRate, "business-kpi", 0.9);
  push("Cache hit rate estimate", "cacheHitRateEstimate", kpis.cacheHitRateEstimate, "business-kpi", 0.85);
  push("Orders throughput", "ordersThroughputPerSec", kpis.ordersThroughputPerSec, "business-kpi", 0.6);

  for (const c of components) {
    if (c.degraded) {
      push(`${c.componentId} degraded`, `${c.componentId}.degraded`, "true", "metrics", 0.9);
    }
    if (c.utilization > 85) {
      push(`${c.componentId} utilization high`, `${c.componentId}.utilization`, c.utilization, "metrics", 0.8);
    }
    if (c.errorRate > 5) {
      push(`${c.componentId} error rate`, `${c.componentId}.errorRate`, c.errorRate, "metrics", 0.8);
    }
  }

  return { observation, evidence };
}
