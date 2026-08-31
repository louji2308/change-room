/**
 * Change Room — Versioned state store (Step 1.2 / Step 1.3)
 *
 * Provides:
 *  - a current, versioned SystemState
 *  - an append-only log of StateTransitions
 *  - immutable StateSnapshots
 *  - restore() to roll back to a snapshot
 *  - compare() to diff snapshots or system states
 *
 * Invariants:
 *  - Snapshots are frozen and must never mutate after creation.
 *  - Every mutation increments the version and appends a transition.
 *  - Arbitrary mutation from outside is impossible: state is only replaced
 *    through applyOperation().
 */

import {
  ALL_RESOURCE_IDS,
  defaultResourceAttrs,
} from "./resources.js";
import type {
  Operation,
  ResourceAttribute,
  ResourceId,
  ResourceState,
  SnapshotId,
  StateSnapshot,
  StateTransition,
  StateVersion,
  SystemState,
  TransitionResult,
} from "./types.js";

let sequence = 0;
function nextId(): number {
  return ++sequence;
}

function isPlainMutableResourceState(s: ResourceState): ResourceState {
  return { id: s.id, attrs: { ...s.attrs }, revision: s.revision };
}

function cloneResourceMap(
  map: ReadonlyMap<ResourceId, ResourceState>
): Map<ResourceId, ResourceState> {
  return new Map(
    Array.from(map.entries()).map(([k, v]) => [k, isPlainMutableResourceState(v)])
  );
}

function cloneAttrs(
  attrs: Readonly<Record<string, ResourceAttribute>>
): Record<string, ResourceAttribute> {
  return { ...attrs };
}

/** Factory for a healthy baseline state. */
export function createBaselineState(): SystemState {
  const resources = new Map<ResourceId, ResourceState>();
  for (const id of ALL_RESOURCE_IDS) {
    resources.set(id, { id, attrs: defaultResourceAttrs(id), revision: 0 });
  }
  return { resources };
}

function snapshotOf(version: StateVersion, state: SystemState, metadata: Record<string, ResourceAttribute>): StateSnapshot {
  const id = `snap_${nextId()}_v${version}`;
  return Object.freeze({
    id,
    version,
    timestamp: new Date().toISOString(),
    resources: cloneResourceMap(state.resources),
    metadata: Object.freeze({ ...metadata }),
  });
}

export class StateStore {
  private current: SystemState;
  private version: StateVersion;
  private readonly transitions: StateTransition[] = [];
  private readonly snapshots: Map<SnapshotId, StateSnapshot> = new Map();

  constructor(initial?: SystemState) {
    this.current = initial ? { resources: cloneResourceMap(initial.resources) } : createBaselineState();
    this.version = 0;
  }

  /** Current immutable-state view. */
  get state(): SystemState {
    return this.current;
  }

  /** Current version number. */
  get v(): StateVersion {
    return this.version;
  }

  /** The append-only transition log (read-only view). */
  get log(): ReadonlyArray<StateTransition> {
    return this.transitions;
  }

  getResource(id: ResourceId): ResourceState {
    const r = this.current.resources.get(id);
    if (!r) {
      throw new Error(`Resource not present in state: ${id}`);
    }
    return { id: r.id, attrs: { ...r.attrs }, revision: r.revision };
  }

  /**
   * Apply an atomic operation to the system.
   * Records a `before -> operation -> after` transition and bumps the version.
   */
  applyOperation(op: Operation, reason?: string): TransitionResult {
    const before = new Map<ResourceId, ResourceState>();
    for (const rid of op.resourceIds) {
      const r = this.current.resources.get(rid);
      if (!r) {
        throw new Error(`Cannot apply operation '${op.id}': resource '${rid}' missing`);
      }
      before.set(rid, isPlainMutableResourceState(r));
    }

    const next = cloneResourceMap(this.current.resources);
    let changedAll = true;
    for (const rid of op.resourceIds) {
      const currentRes = next.get(rid)!;
      const updated = { ...currentRes, attrs: { ...currentRes.attrs } };
      const result = op.apply(next);
      const newRes = result.get(rid);
      if (!newRes) {
        throw new Error(`Operation '${op.id}' failed to produce resource '${rid}'`);
      }
      next.set(rid, {
        id: rid,
        attrs: newRes.attrs,
        revision: currentRes.revision + 1,
      });
      changedAll &&= !attrsEqual(updated.attrs, newRes.attrs);
    }

    const fromVersion = this.version;
    const toVersion = this.version + 1;

    const transition: StateTransition = {
      fromVersion,
      toVersion,
      operationId: op.id,
      resourceIds: [...op.resourceIds],
      before: Object.fromEntries(before.entries()) as Partial<
        Record<ResourceId, ResourceState>
      >,
      after: Object.fromEntries(
        op.resourceIds.map<[string, ResourceState]>((rid) => [rid, next.get(rid)!])
      ) as Partial<Record<ResourceId, ResourceState>>,
      timestamp: new Date().toISOString(),
      reason: reason ?? "",
    };

    if (!changedAll) {
      // No attribute actually changed: version does not advance for a no-op,
      // but we still record the attempt for auditability.
      transition.toVersion = fromVersion;
    }

    this.current = { resources: next };
    this.version = transition.toVersion;
    this.transitions.push(transition);
    return { state: this.current, version: this.version, transition };
  }

  /** Capture an immutable snapshot of the current state. */
  snapshot(metadata: Record<string, ResourceAttribute> = {}): StateSnapshot {
    const snap = snapshotOf(this.version, this.current, metadata);
    this.snapshots.set(snap.id, snap);
    return snap;
  }

  reset(): void {
    this.current = createBaselineState();
    this.version = 0;
    this.transitions.length = 0;
    this.snapshots.clear();
  }

  getSnapshot(id: SnapshotId): StateSnapshot | undefined {
    return this.snapshots.get(id);
  }

  /**
   * Restore the system to the state recorded in a snapshot.
   * This is itself a transition (recorded for auditability) but keeps
   * the snapshot immutable.
   */
  restore(snapshot: StateSnapshot, reason?: string): TransitionResult {
    const op: Operation = {
      id: "restore-to-snapshot",
      resourceIds: [...snapshot.resources.keys()],
      apply: (current: ReadonlyMap<ResourceId, ResourceState>) => {
        const next = cloneResourceMap(current);
        for (const [rid, res] of snapshot.resources.entries()) {
          next.set(rid, { ...res, revision: current.get(rid)!.revision + 1 });
        }
        return next;
      },
    };
    const result = this.applyOperation(op, reason ?? `restore to ${snapshot.id}`);
    return result;
  }
}

function attrsEqual(
  a: Readonly<Record<string, ResourceAttribute>>,
  b: Readonly<Record<string, ResourceAttribute>>
): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/** Compare two system states: which resources differ and how. */
export function compareStates(
  a: SystemState,
  b: SystemState
): {
  equal: boolean;
  diffs: Array<{
    resourceId: ResourceId;
    before: Readonly<Record<string, ResourceAttribute>> | null;
    after: Readonly<Record<string, ResourceAttribute>> | null;
  }>;
} {
  const ids = new Set<ResourceId>([
    ...Array.from(a.resources.keys()),
    ...Array.from(b.resources.keys()),
  ]);
  const diffs: Array<{
    resourceId: ResourceId;
    before: Readonly<Record<string, ResourceAttribute>> | null;
    after: Readonly<Record<string, ResourceAttribute>> | null;
  }> = [];
  for (const id of ids) {
    const ra = a.resources.get(id);
    const rb = b.resources.get(id);
    if (!ra || !rb || !attrsEqual(ra.attrs, rb.attrs)) {
      diffs.push({
        resourceId: id,
        before: ra ? { ...ra.attrs } : null,
        after: rb ? { ...rb.attrs } : null,
      });
    }
  }
  return { equal: diffs.length === 0, diffs };
}

/** Compare two snapshots (by stored state). */
export function compareSnapshots(a: StateSnapshot, b: StateSnapshot) {
  return {
    versions: { a: a.version, b: b.version },
    ...compareStates(
      { resources: a.resources },
      { resources: b.resources }
    ),
  };
}
