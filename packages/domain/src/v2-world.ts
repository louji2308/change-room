/**
 * V2 world-model types.
 *
 * A "world" is the agent's structured representation of the system state.
 * Revisions track how that representation evolves; branches explore
 * counterfactual futures before any real change is committed.
 */

export interface WorldRevision {
  /** Monotonically increasing revision number. */
  revision: number;
  /** Wall-clock time the revision was captured. */
  timestamp: number;
  /** Parent revision this was derived from (null for root). */
  parentRevision: number | null;
}

export interface WorldSnapshot {
  /** Unique id for this snapshot. */
  id: string;
  /** World revision this snapshot represents. */
  revision: number;
  /** The full world state payload. */
  world: Record<string, unknown>;
  /** When the snapshot was taken. */
  capturedAt: number;
  /** Content fingerprint for dedup / staleness detection. */
  fingerprint: string;
}

export interface WorldBranch {
  /** Unique branch id. */
  id: string;
  /** World revision the branch diverges from. */
  parentWorldRevision: number;
  /** The plan that produced this branch. */
  originatingPlanId: string;
  /** Action ids explored on this branch. */
  actions: string[];
  /** State before the branch actions. */
  initialState: WorldSnapshot;
  /** State after the branch actions. */
  finalState: WorldSnapshot;
  /** Simulated KPI deltas. */
  metrics: Record<string, number>;
  /** Agent health assessment of the branch outcome. */
  health: "healthy" | "degraded" | "critical" | "recovered";
  /** Normalised business impact score. */
  businessImpact: number;
  /** Risk classification for the branch. */
  risk: "low" | "medium" | "high";
  /** How long the simulation took (ms). */
  simulationDuration: number;
  /** Assumptions that held during simulation. */
  assumptions: string[];
  /** Whether this branch is a prediction or actual outcome. */
  outcome: "predicted" | "actual";
}
