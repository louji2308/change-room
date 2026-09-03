/**
 * World Generator (§7) — produces valid, coherent worlds from a seed.
 *
 * A generated world specifies topology + baseline workload + resource
 * capacities + service behavior + dependency behavior + queues + caches +
 * deployment state + environmental variability — all derived deterministically
 * from the seed.
 *
 * §7.1 requirements, §7.2 constraints (validateWorld/repairWorld).
 */

import { WorldState } from "./world/world-state.js";
import { TOPOLOGY, topologyById } from "./world/topology.js";
import { defaultTuning, cloneTuning } from "./world/tuning.js";
import type { WorldTuning } from "./world/tuning.js";
import { SeededRng } from "./kernel/rng.js";
import { tick } from "./causal/engine.js";
import { validateWorld, repairWorld } from "./causal/constraints.js";
import {
  generateBaselineConditions,
} from "./environment/conditions.js";
import type { EnvironmentCondition } from "./environment/conditions.js";
import { computeEnvMultipliers } from "./environment/conditions.js";

export interface WorldGeneratorOpts {
  seed: number;
  /** Override traffic level; if omitted derived from seed. */
  trafficLevel?: number;
  /** Number of baseline ticks to run for stabilization. */
  baselineTicks?: number;
  /** Override topology ids; if omitted uses canonical TOPOLOGY. */
  topology?: string[];
}

export interface GeneratedWorld {
  world: WorldState;
  tuning: WorldTuning;
  conditions: EnvironmentCondition[];
  seed: number;
}

/**
 * Generate a valid, coherent world. Same seed always produces the same world.
 *
 * Steps:
 *  1. Create a WorldState from the (possibly overridden) topology.
 *  2. Generate a traffic level from the seed (1000..2500).
 *  3. Run a few baseline ticks to reach steady state.
 *  4. Generate environment conditions from the seed.
 *  5. Validate + repair to guarantee physical plausibility.
 */
export function generateWorld(opts: WorldGeneratorOpts): GeneratedWorld {
  const rng = new SeededRng(opts.seed);
  const topologyIds = opts.topology ?? TOPOLOGY.map((c) => c.id);

  // Validate that all topology ids exist in canonical TOPOLOGY.
  for (const id of topologyIds) {
    topologyById(id);
  }

  const trafficLevel = opts.trafficLevel ?? Math.round(rng.range(1000, 2500));
  const tuning = defaultTuning(trafficLevel);

  // Create world and run a few baseline ticks for stabilization.
  const world = new WorldState(topologyIds);
  const baselineTicks = opts.baselineTicks ?? 15;
  for (let i = 1; i <= baselineTicks; i++) {
    const perTick = trafficLevel * Math.min(1, i / 5);
    tick(world, defaultTuning(Math.round(perTick)), 1);
  }

  // Generate environment conditions.
  const conditions = generateBaselineConditions(opts.seed, baselineTicks + 10);

  // Validate and repair.
  const violations = validateWorld(world);
  if (violations.length > 0) {
    repairWorld(world);
    // Re-validate after repair.
    const still = validateWorld(world);
    if (still.length > 0) {
      throw new Error(
        `World generation produced irreparable state: ${still.map((v) => `${v.componentId}: ${v.message}`).join("; ")}`
      );
    }
  }

  // Final plausibility checks on tuning.
  if (tuning.trafficLevel < 0) {
    throw new Error("Generated traffic level is negative");
  }

  return { world, tuning, conditions, seed: opts.seed };
}
