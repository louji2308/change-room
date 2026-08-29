/**
 * Mutable world state — the per-component state that evolves over simulated
 * time through the causal engine. `version` increments on every tick so that
 * plans can be checked against state freshness (stale-plan detection).
 */

export interface ComponentState {
  id: string;
  /** Work arriving this tick (requests/s). */
  inboundLoad: number;
  /** Utilization 0..100. */
  utilization: number;
  /** Observed latency in ms. */
  latencyMs: number;
  /** Pending work in this component's queue. */
  queueDepth: number;
  /** Error rate 0..100. */
  errorRate: number;
  /** Whether this component is currently in a degraded state. */
  degraded: boolean;
  /** Last reason string for observability/logging. */
  reason?: string;
}

export class WorldState {
  readonly components: Map<string, ComponentState> = new Map();
  version = 0;

  constructor(ids: string[]) {
    for (const id of ids) {
      this.components.set(id, {
        id,
        inboundLoad: 0,
        utilization: 0,
        latencyMs: 0,
        queueDepth: 0,
        errorRate: 0,
        degraded: false,
      });
    }
  }

  get(id: string): ComponentState {
    const c = this.components.get(id);
    if (!c) throw new Error(`Unknown component '${id}' in world`);
    return c;
  }

  /** Deep-copy this world state (for prediction branches). */
  clone(): WorldState {
    const copy = new WorldState([]);
    for (const [id, c] of this.components) {
      copy.components.set(id, { ...c });
    }
    copy.version = this.version;
    return copy;
  }

  /** A cheap structural fingerprint used to compare worlds. */
  fingerprint(): string {
    const parts: string[] = [];
    for (const [id, c] of this.components) {
      parts.push(
        `${id}:${Math.round(c.inboundLoad)}:${Math.round(c.utilization)}:${Math.round(c.latencyMs)}:${Math.round(c.queueDepth)}:${Math.round(c.errorRate)}`
      );
    }
    return parts.join("|");
  }
}
