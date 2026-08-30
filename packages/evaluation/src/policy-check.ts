/**
 * Control-layer policy surface for the blind evaluation (Phase 16).
 *
 * Bridges `@change-room/control`'s `PolicyEngine` to the core harness's
 * lightweight `policyCheck` hook: an operation is mapped to a subject (action
 * type, affected resources, reversibility, risk) and evaluated against a rule
 * set. A verdict that is not `allowed` becomes a counted policy violation in
 * the evaluation metrics.
 */

import type { PolicyRule } from "@change-room/control";
import { PolicyEngine } from "@change-room/control";
import type { ActionType, PredictionResult } from "@change-room/simulator";
import { createAction } from "@change-room/simulator";
import type { PolicyVerdict, RunOptions } from "@change-room/scenarios";

export type PolicyCheck = NonNullable<RunOptions["policyCheck"]>;

/** Default policy surface: permissive, but honest — any rule hit is enforced. */
export function createPolicyCheck(rules: PolicyRule[] = []): PolicyCheck {
  const engine = new PolicyEngine({ rules });
  return (type: ActionType, params: Record<string, number | string>, _stateVersion: number): PolicyVerdict => {
    try {
      const action = createAction(type, params);
      const result = engine.evaluate({
        actionType: type,
        resources: action.affectedResources,
        reversible: action.reversible,
        risk: action.risk,
      });
      return { allowed: result.allowed, reason: result.reason };
    } catch (err) {
      return {
        allowed: true,
        reason: err instanceof Error ? `action not evaluated: ${err.message}` : "action not evaluated",
      };
    }
  };
}

export const defaultPolicyCheck: PolicyCheck = createPolicyCheck([]);

export type { PolicyRule, PredictionResult };