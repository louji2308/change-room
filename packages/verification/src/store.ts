/**
 * Prediction vs Reality store (Phase 9).
 *
 * In-memory log of predicted outcomes and actual post-execution records, keyed
 * by plan id. `compare` joins the latest prediction and actual for a plan and
 * produces a ComparisonResult (UNKNOWN + reason when either side is missing).
 */

import { classifyDeviation } from "./verdict.js";
import type { Verdict, Deviation } from "./verdict.js";

export interface PredictionRecord {
  planId: string;
  stateVersion: number;
  predicted: Record<string, number>;
  predictedHealth: string;
  assumptions: string[];
  timestamp: number;
}

export interface ActualRecord {
  planId: string;
  stateVersion: number;
  actual: Record<string, number>;
  actualHealth: string;
  timestamp: number;
}

export interface CompareOptions {
  threshold?: number;
  worseIsBetter?: string[];
}

export interface ComparisonResult {
  planId: string;
  prediction: PredictionRecord | null;
  actual: ActualRecord | null;
  verdict: Verdict;
  deviations: Deviation[];
  summary: string;
  stateVersionMatched: boolean;
  reason?: string;
}

export class PredictionVsReality {
  private predictions: PredictionRecord[] = [];
  private actuals: ActualRecord[] = [];

  recordPrediction(record: PredictionRecord): void {
    this.predictions.push(record);
  }

  recordActual(record: ActualRecord): void {
    this.actuals.push(record);
  }

  /** All stored records, newest first, for UI/replay. */
  records(): { predictions: PredictionRecord[]; actuals: ActualRecord[] } {
    return {
      predictions: [...this.predictions].reverse(),
      actuals: [...this.actuals].reverse(),
    };
  }

  /** Compact summary: counts plus newest comparison per plan. */
  summary(): { predictionCount: number; actualCount: number; comparisons: ComparisonResult[] } {
    const plans = new Set<string>();
    for (const p of this.predictions) plans.add(p.planId);
    for (const a of this.actuals) plans.add(a.planId);
    const comparisons = [...plans].map((id) => this.compare(id));
    return { predictionCount: this.predictions.length, actualCount: this.actuals.length, comparisons };
  }

  private latest<T extends { planId: string }>(log: T[], planId: string): T | undefined {
    for (let i = log.length - 1; i >= 0; i--) {
      if (log[i].planId === planId) return log[i];
    }
    return undefined;
  }

  compare(planId: string, opts: CompareOptions = {}): ComparisonResult {
    const prediction = this.latest(this.predictions, planId);
    const actual = this.latest(this.actuals, planId);

    if (!prediction) {
      return {
        planId,
        prediction: null,
        actual: actual ?? null,
        verdict: "UNKNOWN",
        deviations: [],
        summary: `UNKNOWN: no prediction recorded for plan ${planId}`,
        stateVersionMatched: false,
        reason: "NO_PREDICTION",
      };
    }
    if (!actual) {
      return {
        planId,
        prediction,
        actual: null,
        verdict: "UNKNOWN",
        deviations: [],
        summary: `UNKNOWN: no actual outcome recorded for plan ${planId}`,
        stateVersionMatched: false,
        reason: "NO_ACTUAL",
      };
    }

    const stateVersionMatched = prediction.stateVersion === actual.stateVersion;
    const classification = classifyDeviation({
      predicted: prediction.predicted,
      actual: actual.actual,
      threshold: opts.threshold,
      worseIsBetter: opts.worseIsBetter,
    });
    return {
      planId,
      prediction,
      actual,
      verdict: classification.verdict,
      deviations: classification.deviations,
      summary: classification.summary,
      stateVersionMatched,
    };
  }
}