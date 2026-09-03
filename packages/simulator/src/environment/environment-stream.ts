/**
 * Environment event stream — models the continuous, natural perturbations
 * that occur in any real system even without a discrete incident.
 *
 * Traffic shifts, capacity drift, dependency jitter, and thermal noise are
 * the background radiation of a living production system. They modulate
 * tuning parameters so the world evolves organically between incidents.
 */

import { SeededRng } from "../kernel/rng.js";
import { cloneTuning } from "../world/tuning.js";
import type { WorldTuning } from "../world/tuning.js";
import { TOPOLOGY } from "../world/topology.js";

export type EnvironmentEventKind =
  | "traffic_shift"
  | "capacity_drift"
  | "dependency_jitter"
  | "thermal"
  | "noise";

export interface EnvironmentEvent {
  time: number;
  kind: EnvironmentEventKind;
  /** Semantic magnitude — interpretation depends on kind. */
  magnitude: number;
  /** Component IDs this event affects (empty = global). */
  affectedComponents: string[];
  /** Human-readable description for observability. */
  description: string;
}

/** Component IDs eligible for component-scoped environment events. */
const COMPONENT_POOL = TOPOLOGY.filter((c) => c.kind !== "traffic").map((c) => c.id);

/**
 * Seeded generator that produces environment events over a simulated duration.
 * Same seed → same event sequence (deterministic).
 */
export class EnvironmentStream {
  private readonly events: EnvironmentEvent[];
  private idx = 0;

  constructor(events: EnvironmentEvent[]) {
    this.events = [...events].sort((a, b) => a.time - b.time);
  }

  /** Peek at the next event without consuming it. */
  peek(): EnvironmentEvent | undefined {
    return this.events[this.idx];
  }

  /** Consume and return the next event. */
  next(): EnvironmentEvent | undefined {
    return this.events[this.idx++];
  }

  /** Return all events whose time is in (from, to]. */
  eventsInRange(from: number, to: number): EnvironmentEvent[] {
    return this.events.filter((e) => e.time > from && e.time <= to);
  }

  get totalEvents(): number {
    return this.events.length;
  }
}

/**
 * Produce a seeded sequence of natural environment events.
 *
 * @param seed        RNG seed (deterministic output)
 * @param duration    Simulated seconds to cover
 * @param density     Average events per second (default 0.1 = ~1 every 10s)
 */
export function generateEnvironmentEvents(
  seed: number,
  duration: number,
  density = 0.1
): EnvironmentStream {
  const rng = new SeededRng(seed);
  const expectedCount = Math.max(1, Math.round(duration * density));
  const events: EnvironmentEvent[] = [];

  for (let i = 0; i < expectedCount; i++) {
    const time = rng.range(1, duration);
    const kind = pickKind(rng);
    const { magnitude, affectedComponents, description } = generatePayload(rng, kind);
    events.push({ time, kind, magnitude, affectedComponents, description });
  }

  events.sort((a, b) => a.time - b.time);
  return new EnvironmentStream(events);
}

function pickKind(rng: SeededRng): EnvironmentEventKind {
  const kinds: EnvironmentEventKind[] = [
    "traffic_shift",
    "capacity_drift",
    "dependency_jitter",
    "thermal",
    "noise",
  ];
  return kinds[rng.int(0, kinds.length - 1)];
}

function pickComponents(rng: SeededRng, count: number): string[] {
  const shuffled = [...COMPONENT_POOL];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function generatePayload(
  rng: SeededRng,
  kind: EnvironmentEventKind
): { magnitude: number; affectedComponents: string[]; description: string } {
  switch (kind) {
    case "traffic_shift": {
      // ±5..25% traffic fluctuation
      const sign = rng.chance(0.5) ? 1 : -1;
      const magnitude = sign * rng.range(0.05, 0.25);
      return {
        magnitude,
        affectedComponents: [],
        description: `traffic shifts ${magnitude > 0 ? "up" : "down"} ${Math.round(Math.abs(magnitude) * 100)}%`,
      };
    }
    case "capacity_drift": {
      // Slight capacity degradation on 1-2 components
      const magnitude = rng.range(0.92, 0.99);
      const affected = pickComponents(rng, rng.int(1, 2));
      return {
        magnitude,
        affectedComponents: affected,
        description: `capacity drifts to ${Math.round(magnitude * 100)}% on ${affected.join(",")}`,
      };
    }
    case "dependency_jitter": {
      // Extra latency 5..40ms on a single component
      const magnitude = rng.range(5, 40);
      const affected = pickComponents(rng, 1);
      return {
        magnitude,
        affectedComponents: affected,
        description: `dependency jitter adds ${Math.round(magnitude)}ms on ${affected[0]}`,
      };
    }
    case "thermal": {
      // Heat-related capacity reduction 1-8%
      const magnitude = rng.range(0.92, 0.99);
      return {
        magnitude,
        affectedComponents: [],
        description: `thermal throttling reduces global capacity to ${Math.round(magnitude * 100)}%`,
      };
    }
    case "noise": {
      // Tiny traffic fluctuation ±1..5%
      const sign = rng.chance(0.5) ? 1 : -1;
      const magnitude = sign * rng.range(0.01, 0.05);
      return {
        magnitude,
        affectedComponents: [],
        description: `background noise ${magnitude > 0 ? "adds" : "removes"} ${Math.round(Math.abs(magnitude) * 100)}% traffic`,
      };
    }
  }
}

/**
 * Apply an environment event to a tuning snapshot.
 * Returns a fresh tuning; the input is never mutated.
 */
export function applyEnvironmentEvent(
  base: WorldTuning,
  event: EnvironmentEvent
): WorldTuning {
  const out = cloneTuning(base);

  switch (event.kind) {
    case "traffic_shift": {
      out.trafficLevel = Math.round(out.trafficLevel * (1 + event.magnitude));
      break;
    }
    case "capacity_drift": {
      for (const id of event.affectedComponents) {
        out.capacityMultiplier[id] = (out.capacityMultiplier[id] ?? 1) * event.magnitude;
      }
      break;
    }
    case "dependency_jitter": {
      for (const id of event.affectedComponents) {
        out.latencyModifier[id] = (out.latencyModifier[id] ?? 0) + event.magnitude;
      }
      break;
    }
    case "thermal": {
      // Apply as a global capacity multiplier on all non-traffic components
      for (const id of COMPONENT_POOL) {
        out.capacityMultiplier[id] = (out.capacityMultiplier[id] ?? 1) * event.magnitude;
      }
      break;
    }
    case "noise": {
      out.trafficLevel = Math.round(out.trafficLevel * (1 + event.magnitude));
      break;
    }
  }

  return out;
}
