/**
 * Prediction vs Reality verdict engine (Phase 9).
 *
 * Compares a plan's predicted KPIs against the actual outcome recorded after
 * execution and classifies the deviation as HEALTHY, DEGRADED, REGRESSION or
 * UNKNOWN by measuring relative movement per comparable metric.
 */

import type { BusinessKpis } from "@change-room/simulator";

export type Verdict = "HEALTHY" | "DEGRADED" | "REGRESSION" | "UNKNOWN";

export interface Deviation {
  metric: string;
  predicted: number;
  actual: number;
  delta: number;
  ratio: number;
}

export interface ClassifyDeviationOptions {
  /** Predicted outcome, keyed by metric name. */
  predicted: Record<string, number>;
  /** Actual outcome recorded after execution, keyed by metric name. */
  actual: Record<string, number>;
  /** Relative tolerance before a deviation counts as significant (default 0.15). */
  threshold?: number;
  /** Metrics where a HIGHER value is WORSE (latency, error, load...). */
  worseIsBetter?: string[];
}

export interface Classification {
  verdict: Verdict;
  deviations: Deviation[];
  summary: string;
}

export const DEFAULT_THRESHOLD = 0.15;

export const DEFAULT_WORSE_IS_BETTER = [
  "latencyMs",
  "checkoutLatencyMs",
  "errorRate",
  "checkoutErrorRate",
  "load",
  "utilization",
];

function ratioOf(predicted: number, actual: number): number {
  if (predicted === 0) {
    if (actual === 0) return 1;
    return actual > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  }
  return actual / predicted;
}

function summarize(verdict: Verdict, deviations: Deviation[], threshold: number): string {
  const parts = deviations.map((d) => {
    const pct = Number.isFinite(d.ratio) ? `${(d.ratio * 100).toFixed(0)}%` : "∞";
    return `${d.metric} ${d.predicted} -> ${d.actual} (${pct})`;
  });
  return `${verdict}: ${parts.join(", ")} at \u00b1${(threshold * 100).toFixed(0)}% threshold`;
}

export function classifyDeviation(opts: ClassifyDeviationOptions): Classification {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const worseIsBetter = new Set(opts.worseIsBetter ?? DEFAULT_WORSE_IS_BETTER);

  const deviations: Deviation[] = [];
  for (const [metric, predicted] of Object.entries(opts.predicted)) {
    if (!(metric in opts.actual)) continue;
    const actual = opts.actual[metric];
    deviations.push({ metric, predicted, actual, delta: actual - predicted, ratio: ratioOf(predicted, actual) });
  }

  if (deviations.length === 0) {
    return { verdict: "UNKNOWN", deviations, summary: "UNKNOWN: no comparable metrics between prediction and actual" };
  }

  const significant = (d: Deviation) => Math.abs(d.ratio - 1) > threshold;

  const regressed = deviations.some((d) => {
    if (!significant(d)) return false;
    if (worseIsBetter.has(d.metric)) return d.ratio > 1 + threshold;
    return d.ratio < 1 - threshold;
  });

  if (regressed) return { verdict: "REGRESSION", deviations, summary: summarize("REGRESSION", deviations, threshold) };
  if (!deviations.some(significant)) return { verdict: "HEALTHY", deviations, summary: summarize("HEALTHY", deviations, threshold) };
  return { verdict: "DEGRADED", deviations, summary: summarize("DEGRADED", deviations, threshold) };
}

/** Flatten a BusinessKpis object into metric-name -> number (systemHealth is skipped). */
export function metricsOf(kpis: BusinessKpis): Record<string, number> {
  return {
    checkoutLatencyMs: kpis.checkoutLatencyMs,
    checkoutErrorRate: kpis.checkoutErrorRate,
    checkoutSuccessRate: kpis.checkoutSuccessRate,
    ordersThroughputPerSec: kpis.ordersThroughputPerSec,
    cacheHitRateEstimate: kpis.cacheHitRateEstimate,
  };
}