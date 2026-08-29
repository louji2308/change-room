/**
 * Operational actions (Simulator.md §21; Implementation.md §2.4).
 *
 * Actions are *formal* operations the agent can propose: each has a type,
 * optional target, parameters, affected resources, preconditions, reversibility
 * and risk. Applying an action mutates the world tuning; the causal engine
 * then derives the consequences. Actions never touch raw state directly.
 */

import { cloneTuning } from "../world/tuning.js";
import type { WorldTuning } from "../world/tuning.js";

export type ActionType =
  | "increase_cache_capacity"
  | "restart_cache"
  | "scale_service"
  | "scale_database"
  | "rollback_deployment"
  | "change_configuration"
  | "restore_configuration"
  | "do_nothing";

export type RiskLevel = "low" | "medium" | "high";

export interface Action {
  id: string;
  type: ActionType;
  target?: string;
  parameters: Record<string, number | string>;
  affectedResources: string[];
  reversible: boolean;
  risk: RiskLevel;
  /** Precondition validator: returns unmet-precondition messages (empty = OK). */
  validate: (tuning: WorldTuning) => string[];
  /** Apply to a *copy* of tuning; the input tuning is never mutated. */
  apply: (tuning: WorldTuning) => WorldTuning;
}

function mkAction(
  type: ActionType,
  params: Record<string, number | string>,
  affectedResources: string[],
  reversible: boolean,
  risk: RiskLevel,
  validate: (t: WorldTuning) => string[],
  apply: (t: WorldTuning) => WorldTuning
): Action {
  return {
    id: `action_${type}_${Date.now()}`,
    type,
    parameters: { ...params },
    affectedResources,
    reversible,
    risk,
    validate,
    apply,
  };
}

/**
 * Create a typed action. This is the single factory used by planning/WebMCP so
 * that every action carries its full contract.
 */
export function createAction(
  type: ActionType,
  params: Record<string, number | string> = {}
): Action {
  switch (type) {
    case "increase_cache_capacity":
      return mkAction(
        type,
        { newCapacityGB: params.newCapacityGB ?? 30 },
        ["cache", "database"],
        true,
        "low",
        (t) => {
          const cap = Number(params.newCapacityGB ?? 30);
          return cap <= 0 ? ["newCapacityGB must be positive"] : [];
        },
        (t) => {
          const next = cloneTuning(t);
          // Restore/boost cache capacity (undo degradation).
          next.capacityMultiplier.cache = Math.max(
            next.capacityMultiplier.cache ?? 1,
            1.2
          );
          return next;
        }
      );
    case "restart_cache":
      return mkAction(
        type,
        {},
        ["cache"],
        true,
        "low",
        () => [],
        (t) => {
          const next = cloneTuning(t);
          delete next.capacityMultiplier.cache;
          delete next.latencyModifier.cache;
          return next;
        }
      );
    case "scale_service":
      return mkAction(
        type,
        { service: params.service ?? "checkout", factor: Number(params.factor ?? 1.5) },
        [String(params.service ?? "checkout")],
        true,
        "medium",
        (t) => {
          const target = String(params.service ?? "checkout");
          return target === "traffic" ? ["cannot scale traffic directly"] : [];
        },
        (t) => {
          const target = String(params.service ?? "checkout");
          const factor = Number(params.factor ?? 1.5);
          const next = cloneTuning(t);
          next.capacityMultiplier[target] = (next.capacityMultiplier[target] ?? 1) * factor;
          return next;
        }
      );
    case "scale_database":
      return mkAction(
        type,
        { factor: Number(params.factor ?? 1.5) },
        ["database", "queue"],
        true,
        "medium",
        () => [],
        (t) => {
          const factor = Number(params.factor ?? 1.5);
          const next = cloneTuning(t);
          next.capacityMultiplier.database = (next.capacityMultiplier.database ?? 1) * factor;
          return next;
        }
      );
    case "rollback_deployment":
      return mkAction(
        type,
        {},
        ["api-gateway", "checkout"],
        true,
        "high",
        () => [],
        (t) => {
          const next = cloneTuning(t);
          delete next.latencyModifier["api-gateway"];
          next.capacityMultiplier["api-gateway"] = 1;
          return next;
        }
      );
    case "change_configuration":
      return mkAction(
        type,
        { setting: params.setting ?? "connectionPoolSize", value: Number(params.value ?? 60) },
        ["configuration", String(params.setting ?? "database")],
        true,
        "medium",
        () => [],
        (t) => {
          const next = cloneTuning(t);
          // A config change to connection pool size increases DB capacity.
          const value = Number(params.value ?? 60);
          if (String(params.setting) === "connectionPoolSize") {
            next.capacityMultiplier.database = Math.max(
              next.capacityMultiplier.database ?? 1,
              value / 40
            );
          }
          return next;
        }
      );
    case "restore_configuration":
      return mkAction(
        type,
        {},
        ["database", "cache", "api-gateway"],
        true,
        "low",
        () => [],
        (t) => {
          const next = cloneTuning(t);
          delete next.capacityMultiplier.database;
          delete next.capacityMultiplier.cache;
          delete next.latencyModifier["api-gateway"];
          return next;
        }
      );
    case "do_nothing":
      return mkAction(
        type,
        {},
        [],
        true,
        "low",
        () => [],
        (t) => cloneTuning(t)
      );
  }
}

/** Apply an action to a tuning copy, validating preconditions first. */
export function applyAction(
  tuning: WorldTuning,
  action: Action
): { ok: boolean; unmet: string[]; tuning: WorldTuning } {
  const unmet = action.validate(tuning);
  if (unmet.length > 0) {
    return { ok: false, unmet, tuning };
  }
  return { ok: true, unmet: [], tuning: action.apply(tuning) };
}
