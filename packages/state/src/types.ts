/**
 * Change Room — Operational State Model
 *
 * This is the internal representation of the world Change Room operates on.
 * It is deliberately independent of any UI, agent, or storage backend.
 *
 * Core invariant: every mutation of the system is a *transition* that records
 * `before -> operation -> after`. Arbitrary, unversioned mutation is forbidden.
 */

export type ResourceId =
  | "traffic"
  | "service"
  | "cache"
  | "database"
  | "queue"
  | "deployment"
  | "configuration"
  | "inventory"
  | "checkout";

/**
 * A single named scalar attribute on a resource. Kept as a union of the
 * primitive value types the operational model cares about.
 */
export type ResourceAttribute = number | string | boolean | null;

/**
 * Immutable representation of one resource's state.
 * A resource is identified by its id and holds a flat map of named attributes
 * plus its own monotonically increasing revision.
 */
export interface ResourceState {
  id: ResourceId;
  attrs: Readonly<Record<string, ResourceAttribute>>;
  revision: number;
}

/** The full, versioned state of the system at an instant. */
export interface SystemState {
  resources: ReadonlyMap<ResourceId, ResourceState>;
}

/** A stable identifier for a snapshot. */
export type SnapshotId = string;

/**
 * A point-in-time, immutable capture of the system state.
 * Snapshots must NEVER mutate after creation.
 */
export interface StateSnapshot {
  id: SnapshotId;
  version: number;
  timestamp: string;
  resources: ReadonlyMap<ResourceId, ResourceState>;
  metadata: Readonly<Record<string, ResourceAttribute>>;
}

/** A monotonically increasing state version. */
export type StateVersion = number;

/**
 * An atomic mutation of the system represented as:
 *   before -> operation -> after
 */
export interface StateTransition {
  /** The version the system was at before this transition. */
  fromVersion: StateVersion;
  /** The version the system is at after this transition. */
  toVersion: StateVersion;
  /** Stable identity of the operation that caused this transition. */
  operationId: string;
  /** Resource id(s) that changed. */
  resourceIds: ResourceId[];
  /** Before-state of the changed resource(s). */
  before: Partial<Record<ResourceId, ResourceState>>;
  /** After-state of the changed resource(s). */
  after: Partial<Record<ResourceId, ResourceState>>;
  timestamp: string;
  /** Optional captured reason recorded by the actor. */
  reason?: string;
}

/** Result of applying an operation to the system. */
export interface TransitionResult {
  state: SystemState;
  version: StateVersion;
  transition: StateTransition;
}

/** Description of an allowed operation against the state model. */
export interface Operation {
  id: string;
  resourceIds: ResourceId[];
  /** Compute the new attribute map for the affected resources. */
  apply: (current: ReadonlyMap<ResourceId, ResourceState>) => Map<ResourceId, ResourceState>;
  /** Whether this operation can be reversed. Optional: define a reverse op. */
  reverse?: string;
}
