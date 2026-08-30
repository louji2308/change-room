/**
 * Conflict detection (Implementation.md §5.6; Idea.md §38).
 *
 * Detects when another actor (human, automation, agent) changed a resource that
 * a plan depends on after the plan was created. Any such change invalidates the
 * plan and forces re-planning.
 */

import type { Plan } from "@change-room/domain";

export type ActorType = "human" | "agent" | "automation";

export interface StateMutation {
  /** Which resource changed. */
  resource: string;
  /** The actor who made the change. */
  actor: ActorType;
  /** State version AFTER the mutation applied. */
  version: number;
  timestamp: number;
}

export interface ConflictResult {
  conflicted: boolean;
  conflicts: Array<{
    resource: string;
    mutation: StateMutation;
    reason: string;
  }>;
}

/**
 * Compare the mutations that occurred since a plan's state version against the
 * resources that the plan depends on. Any overlap is a conflict.
 */
export function detectConflicts(
  plan: Plan,
  mutationsSince: StateMutation[],
  currentVersion: number
): ConflictResult {
  const conflicts: ConflictResult["conflicts"] = [];
  const planResources = new Set(
    plan.actions.flatMap((a) => resourceOfAction(a.type))
  );

  for (const mut of mutationsSince) {
    if (mut.version > currentVersion) continue;
    if (planResources.has(mut.resource)) {
      conflicts.push({
        resource: mut.resource,
        mutation: mut,
        reason: `resource '${mut.resource}' was changed by ${mut.actor} after plan creation`,
      });
    }
  }

  return { conflicted: conflicts.length > 0, conflicts };
}

/** Map an action type to the resource(s) it primarily touches. */
const ACTION_RESOURCE_MAP: Record<string, string[]> = {
  increase_cache_capacity: ["cache"],
  restart_cache: ["cache"],
  scale_service: ["service"],
  scale_database: ["database"],
  rollback_deployment: ["deployment"],
  change_configuration: ["configuration"],
  restore_configuration: ["configuration"],
  do_nothing: [],
};

function resourceOfAction(type: string): string[] {
  return ACTION_RESOURCE_MAP[type] ?? [type];
}
