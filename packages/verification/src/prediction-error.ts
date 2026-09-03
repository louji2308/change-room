/**
 * Prediction error analysis (implementation-v2.md §11.4, §12.1).
 *
 * First-class treatment of a prediction mismatch: compute absolute and relative
 * error per metric, attribute a likely cause where evidence allows, and produce
 * a structured PredictionMismatch event so the system re-investigates rather
 * than building a false success state.
 */

export type ErrorAttribution =
  | "model-underestimate"
  | "model-overestimate"
  | "state-drift"
  | "action-mismatch"
  | "unknown";

export interface MetricError {
  metric: string;
  predicted: number;
  actual: number;
  /** absolute error */
  absolute: number;
  /** signed relative error (actual/predicted) - 1 * sign handled by caller */
  relative: number;
  /** percentage of relative error, tile-safe (0 when predicted is 0). */
  percent: number;
}

export interface PredictionErrorReport {
  planId: string;
  worldRevision: number;
  errors: MetricError[];
  meanAbsoluteError: number;
  maxErrorMetric: string;
  /** true when ANY metric deviates beyond the given threshold. */
  mismatched: boolean;
  attribution: ErrorAttribution;
  cause: string;
}

export interface ComputePredictionErrorOpts {
  planId: string;
  worldRevision: number;
  predicted: Record<string, number>;
  actual: Record<string, number>;
  /** relative motion tolerance (default 0.15). */
  threshold?: number;
  /** true if the actual state's revision differed from the prediction's revision. */
  stateDrifted?: boolean;
}

function relativeOf(predicted: number, actual: number): number {
  if (predicted === 0) return actual === 0 ? 0 : Number.POSITIVE_INFINITY;
  return (actual - predicted) / predicted;
}

const DEFAULT_MAX_REL_ERROR = 0.5;

/** Compute per-metric errors plus a single attribution. */
export function computePredictionError(opts: ComputePredictionErrorOpts): PredictionErrorReport {
  const threshold = opts.threshold ?? DEFAULT_MAX_REL_ERROR;
  const errors: MetricError[] = [];
  for (const [metric, predicted] of Object.entries(opts.predicted)) {
    const actual = opts.actual[metric];
    if (actual === undefined) continue;
    const relative = relativeOf(predicted, actual);
    errors.push({
      metric,
      predicted,
      actual,
      absolute: Math.abs(actual - predicted),
      relative,
      percent: Number.isFinite(relative) ? Math.abs(relative) : Number.MAX_SAFE_INTEGER,
    });
  }

  const meanAbsoluteError =
    errors.length === 0
      ? 0
      : errors.reduce((sum, e) => sum + Math.abs(e.absolute), 0) / errors.length;

  const max = errors.reduce<MetricError | null>((acc, e) => {
    if (!acc) return e;
    return Math.abs(e.relative) > Math.abs(acc.relative) ? e : acc;
  }, null);

  const mismatched = errors.some((e) => Math.abs(e.relative) > threshold);

  let attribution: ErrorAttribution = "unknown";
  let cause = "no comparable metrics";
  if (errors.length > 0) {
    const maxErr = max!;
    const biggerThanPredicted = maxErr.actual > maxErr.predicted;
    if (opts.stateDrifted) {
      attribution = "state-drift";
      cause = `world advanced between prediction (rev ${opts.worldRevision}) and actual`;
    } else if (biggerThanPredicted) {
      attribution = "model-underestimate";
      cause = `prediction underestimated ${maxErr.metric} (${maxErr.predicted} -> ${maxErr.actual}) — dynamics stronger than modeled`;
    } else if (maxErr.actual < maxErr.predicted) {
      attribution = "model-overestimate";
      cause = `prediction overestimated ${maxErr.metric} (${maxErr.predicted} -> ${maxErr.actual}) — intervention more effective than modeled`;
    }
  }

  return {
    planId: opts.planId,
    worldRevision: opts.worldRevision,
    errors,
    meanAbsoluteError,
    maxErrorMetric: max?.metric ?? "",
    mismatched,
    attribution,
    cause,
  };
}

/** True when the report represents a material prediction/reality mismatch. */
export function isMismatch(report: PredictionErrorReport, threshold = DEFAULT_MAX_REL_ERROR): boolean {
  return report.mismatched;
}
