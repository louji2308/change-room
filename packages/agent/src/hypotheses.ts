/**
 * Hypothesis engine (Implementation.md §6.3; Idea.md §17–18).
 *
 * Forms and ranks candidate causes from the collected evidence. It deliberately
 * retains uncertainty and supports multiple plausible hypotheses rather than
 * inventing certainty. The result is a belief set the agent reasons under.
 */

import type { Evidence, Hypothesis, SystemObservation } from "@change-room/domain";
import { createHypothesis } from "@change-room/domain";

export interface HypothesisInput {
  evidence: Evidence[];
  observation: SystemObservation;
}

/** Candidate causes and the signal pattern that supports each. */
interface CausePattern {
  cause: string;
  /** Predictions about the observation, each scored 0..1 if evidence matches. */
  matches: Array<{ metric: string; check: (v: number) => boolean; weight: number; label: string }>;
}

const CANDIDATES: CausePattern[] = [
  {
    cause: "cache degradation",
    matches: [
      { metric: "cacheHitRateEstimate", check: (v) => v < 60, weight: 1.0, label: "cache hit rate dropped" },
      { metric: "checkoutLatencyMs", check: (v) => v > 90, weight: 0.7, label: "checkout latency elevated" },
      { metric: "checkoutErrorRate", check: (v) => v > 5, weight: 0.5, label: "checkout errors elevated" },
    ],
  },
  {
    cause: "database saturation",
    matches: [
      { metric: "database.utilization", check: (v) => v > 85, weight: 1.0, label: "database utilization high" },
      { metric: "checkoutLatencyMs", check: (v) => v > 250, weight: 0.8, label: "checkout latency elevated" },
      { metric: "queue.depth", check: (v) => v > 5, weight: 0.7, label: "queue depth growing" },
    ],
  },
  {
    cause: "traffic anomaly",
    matches: [
      { metric: "traffic.utilization", check: (v) => v > 80, weight: 0.9, label: "traffic/load high" },
      { metric: "api-gateway.latencyMs", check: (v) => v > 150, weight: 0.6, label: "gateway latency elevated" },
      { metric: "ordersThroughputPerSec", check: (v) => v > 400, weight: 0.5, label: "throughput elevated" },
    ],
  },
  {
    cause: "bad deployment",
    matches: [
      { metric: "checkout.errorRate", check: (v) => v > 5, weight: 0.9, label: "checkout errors elevated" },
      { metric: "api-gateway.errorRate", check: (v) => v > 5, weight: 0.7, label: "gateway errors elevated" },
      { metric: "checkoutLatencyMs", check: (v) => v > 200, weight: 0.5, label: "latency elevated" },
    ],
  },
  {
    cause: "queue backlog",
    matches: [
      { metric: "queue.depth", check: (v) => v > 5, weight: 1.0, label: "queue depth growing" },
      { metric: "checkoutLatencyMs", check: (v) => v > 250, weight: 0.6, label: "latency elevated" },
    ],
  },
  {
    cause: "configuration regression",
    matches: [
      { metric: "database.utilization", check: (v) => v > 80, weight: 0.7, label: "database engaged" },
      { metric: "cacheHitRateEstimate", check: (v) => v < 60, weight: 0.7, label: "cache miss rising" },
      { metric: "checkout.errorRate", check: (v) => v > 5, weight: 0.5, label: "errors elevated" },
    ],
  },
];

/** Numeric value of an evidence item by metric id (first match). */
function valueFor(evidence: Evidence[], metric: string): number | undefined {
  const hit = evidence.find((e) => e.metric === metric);
  if (hit && typeof hit.value === "number") return hit.value;
  return undefined;
}

/**
 * Rank candidate causes against the observed evidence. Each cause gets a score
 * 0..1 derived from its matched signal strengths, plus supporting/counter
 * evidence ids and a provenance basis. Retains genuine uncertainty.
 */
export function formHypotheses(input: HypothesisInput): Hypothesis[] {
  const { evidence } = input;
  const out: Hypothesis[] = [];

  for (const cand of CANDIDATES) {
    let score = 0;
    let maxScore = 0;
    const support: string[] = [];
    const counter: string[] = [];
    const basis: string[] = [];
    for (const m of cand.matches) {
      maxScore += m.weight;
      const v = valueFor(evidence, m.metric);
      if (v !== undefined) {
        if (m.check(v)) {
          score += m.weight;
          support.push(m.label);
          basis.push(`${m.label} (${m.metric}=${v})`);
        } else {
          counter.push(`${m.label} contradicted`);
        }
      }
    }
    // Normalize but never exceed 1; scale by how much evidence was available.
    const ratio = maxScore > 0 ? score / maxScore : 0;
    // Retain genuine uncertainty: confidence approaches ~0.8 when all signals
    // align but is never certain. Any strong direct signal boosts confidence.
    const confidence = Math.min(0.9, ratio * 0.65 + (support.length >= 2 ? 0.15 : 0));

    out.push(
      createHypothesis({
        cause: cand.cause,
        confidence,
        supporting: support,
        counterevidence: counter,
        missingEvidence: cand.matches.filter((m) => valueFor(evidence, m.metric) === undefined).map((m) => m.label),
        status: support.length > 0 ? "supported" : "proposed",
        basis,
      })
    );
  }

  return out.sort((a, b) => b.confidence - a.confidence);
}
