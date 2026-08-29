/**
 * Computes the effective world tuning at a given simulation time by merging
 * the baseline tuning with all active disturbances. Disturbances ramp in over
 * their `ramp` window and decay after `duration` (0 = persists), which is what
 * creates *time-based* incident evolution (Simulator.md §4, §38).
 */

import type { Disturbance } from "./generator.js";
import { cloneTuning, defaultTuning } from "../world/tuning.js";
import type { WorldTuning } from "../world/tuning.js";

function rampFactor(d: Disturbance, time: number): number {
  const elapsed = time - d.start;
  if (elapsed <= 0) return 0;
  const up = Math.min(1, elapsed / Math.max(1, d.ramp));
  if (d.duration > 0) {
    const held = elapsed - d.ramp;
    if (held > d.duration) {
      const decay = Math.max(0, 1 - (held - d.duration) / Math.max(1, d.ramp));
      return up * decay;
    }
  }
  return up;
}

/**
 * Merge baseline tuning with disturbances active at `time`.
 * Returns a fresh tuning object; the baseline is never mutated.
 */
export function computeTuningAt(
  base: WorldTuning,
  disturbances: Disturbance[],
  time: number
): WorldTuning {
  const out = cloneTuning(base);

  for (const d of disturbances) {
    const f = rampFactor(d, time);
    if (f <= 0) continue;
    switch (d.type) {
      case "traffic_spike": {
        // 1.0 when not applied, up to `magnitude` when fully applied.
        const level = base.trafficLevel * (1 + (d.magnitude - 1) * f);
        out.trafficLevel = Math.round(level);
        break;
      }
      case "cache_degradation": {
        const target = d.magnitude;
        const clamped = 1 + (target - 1) * f; // 1 -> 0.65 e.g.
        out.capacityMultiplier.cache =
          (base.capacityMultiplier.cache ?? 1) * clamped;
        break;
      }
      case "database_contention": {
        const clamped = 1 + (d.magnitude - 1) * f;
        out.capacityMultiplier.database =
          (base.capacityMultiplier.database ?? 1) * clamped;
        break;
      }
      case "dependency_latency": {
        out.latencyModifier.payment =
          (base.latencyModifier.payment ?? 0) + d.magnitude * f;
        break;
      }
      case "deployment_memory": {
        out.latencyModifier["api-gateway"] =
          (base.latencyModifier["api-gateway"] ?? 0) + base.trafficLevel * 0.002 * d.magnitude * f;
        out.capacityMultiplier["api-gateway"] =
          (base.capacityMultiplier["api-gateway"] ?? 1) * (1 - 0.15 * f);
        break;
      }
    }
  }

  return out;
}

export function healthyTuning(): WorldTuning {
  return defaultTuning(1200);
}
