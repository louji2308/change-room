/**
 * Observation — the normalized, agent-facing view of the live system.
 *
 * The agent never sees simulator internals or hidden ground truth; it sees an
 * observation derived from the scenario's agent view. This type is the bridge
 * between the scenario engine and the agent/control layers.
 */

export interface ComponentObservation {
  componentId: string;
  utilization: number;
  latencyMs: number;
  errorRate: number;
  queueDepth: number;
  degraded: boolean;
}

export interface KpiObservation {
  checkoutLatencyMs: number;
  checkoutErrorRate: number;
  checkoutSuccessRate: number;
  ordersThroughputPerSec: number;
  cacheHitRateEstimate: number;
  systemHealth: "healthy" | "degraded" | "down";
}

export interface LogObservation {
  time: number;
  level: "info" | "warn" | "error";
  componentId: string;
  message: string;
}

export interface SystemObservation {
  timestamp: number;
  kpis: KpiObservation;
  components: ComponentObservation[];
  logs: LogObservation[];
  health: "healthy" | "degraded" | "down";
  /** Node/state version so plans can be bound to a snapshot. */
  stateVersion: number;
}
