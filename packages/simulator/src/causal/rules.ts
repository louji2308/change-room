/**
 * Causal behavior rules (Simulator.md §13–16).
 *
 * Real systems are nonlinear: latency is flat below a threshold, climbs through
 * a congestion region, then saturates. We model this with a piecewise curve
 * rather than a naive `load → latency` linear rule.
 */

/** Clamp a value into [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export interface Thresholds {
  latencyThreshold: number; // utilization % where latency starts climbing
  saturationPoint: number;  // utilization % where errors spike
  serviceTimeMs: number;    // idle service time
}

/**
 * Utilization of a component given inbound load and capacity, in percent.
 */
export function utilizationOf(inboundLoad: number, capacity: number): number {
  if (capacity <= 0) return 100;
  return clamp((inboundLoad / capacity) * 100, 0, 100);
}

/**
 * Nonlinear latency curve.
 *  - Below `latencyThreshold`: latency ≈ idle service time.
 *  - Between threshold and saturation: latency grows superlinearly.
 *  - At/above saturation: latency is capped high (requests begin timing out).
 */
export function latencyOf(util: number, t: Thresholds): number {
  const { latencyThreshold, saturationPoint, serviceTimeMs } = t;
  if (util <= latencyThreshold) {
    return serviceTimeMs;
  }
  if (util >= saturationPoint) {
    // peak latency when fully saturated
    return serviceTimeMs * 8;
  }
  const span = saturationPoint - latencyThreshold;
  const progress = (util - latencyThreshold) / span; // 0..1
  // quadratic growth from serviceTimeMs toward 8x at saturation
  const multiplier = 1 + 7 * progress * progress;
  return serviceTimeMs * multiplier;
}

/**
 * Error rate curve (percent). Near zero below a "errorFloor" utilization,
 * rising steeply as utilization crosses toward saturation.
 */
export function errorRateOf(util: number, t: Thresholds): number {
  const { saturationPoint } = t;
  const floor = saturationPoint - 8; // where errors begin
  if (util <= floor) {
    return 0.05; // nominal baseline ~0.05% noise
  }
  const progress = clamp((util - floor) / (saturationPoint - floor), 0, 1);
  // from a few percent to high failure as we reach saturation
  return 1 + 58 * Math.pow(progress, 1.6);
}

/**
 * Queue depth update using a simple discrete arrival/service model:
 *   queue += arrivals - service
 * arrivals and service are scaled to the tick duration.
 */
export function updateQueueDepth(
  currentDepth: number,
  inboundLoad: number,
  capacity: number,
  tickSeconds: number
): number {
  const arrivals = inboundLoad * tickSeconds;
  const service = capacity * tickSeconds;
  return clamp(currentDepth + (arrivals - service), 0, capacity * tickSeconds * 10);
}

/**
 * Backpressure: when a component's error rate is high, the delay it adds to
 * its upstream caller grows, which we surface as extra latency on the caller.
 */
export function backpressureMultiplier(errorRate: number): number {
  return clamp(1 + errorRate / 40, 1, 4);
}
