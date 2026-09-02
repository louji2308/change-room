/**
 * Operation gate (Implementation.md §5, the canonical control boundary).
 *
 * Every consequential operation (execute_change, rollback_change, ...) must
 * pass through this single gate. It composes: policy -> risk -> stale-plan
 * validation -> conflict detection -> authority decision -> permission check.
 * Nothing bypasses it; the gate is the authoritative answer for "may this
 * operation proceed right now?"
 */

import { PolicyEngine, type PolicyResult } from "./policy.js";
import { assessRisk, type RiskInput } from "./risk.js";
import { checkPermission, type PermissionContext } from "./permissions.js";
import { decideAuthority, type AuthorityInput, type DelegationGrant } from "./authority.js";
import { validatePlanFreshness } from "./stale-plan.js";
import { detectConflicts, type StateMutation } from "./conflict.js";
import type { Plan, IntentContract } from "@change-room/domain";

export interface GateContext {
  plan: Plan;
  currentStateVersion: number;
  mutationsSince?: StateMutation[];
  permission: PermissionContext;
  delegation?: DelegationGrant | null;
  intentContract?: IntentContract;
  now: number;
  riskOverrides?: Omit<RiskInput, "affected" | "reversibility">;
}

export type GateDecision = {
  allowed: boolean;
  stage: "policy" | "risk" | "freshness" | "conflict" | "permission" | "authority";
  reason: string;
  approvalRequired: boolean;
  policy: PolicyResult;
  risk: ReturnType<typeof assessRisk>;
  detail?: Record<string, unknown>;
};

/**
 * Evaluate whether `plan` may be executed right now given the current state and
 * actor context. Pure and deterministic — no side effects.
 */
export function evaluateGate(ctx: GateContext, policy: PolicyEngine): GateDecision {
  // 1) Policy: is the action allowed/forbidden/approval-required?
  const policyResult = policy.evaluate(
    {
      actionType: ctx.plan.actions[0]?.type ?? "do_nothing",
      resources: ctx.plan.actions.flatMap((a) => resourcesForAction(a.type)),
      reversible: ctx.plan.reversibility === "fully-reversible" || ctx.plan.reversibility === "partially-reversible",
      risk: ctx.plan.risk.overall,
    },
    ctx.intentContract
  );
  if (!policyResult.allowed) {
    const denyRisk = assessRisk({ affected: [], reversibility: "fully-reversible", declaredRisk: "low" });
    return gate("policy", false, policyResult.reason, true, policyResult, ctx, denyRisk);
  }

  // 2) Risk assessment.
  const risk = assessRisk({
    affected: ctx.plan.actions.flatMap((a) => resourcesForAction(a.type)),
    reversibility: ctx.plan.reversibility,
    declaredRisk: ctx.plan.risk.overall,
    confidence: ctx.plan.confidence,
    stateFreshness: ctx.plan.stateVersion === ctx.currentStateVersion ? "fresh" : "stale",
    ...ctx.riskOverrides,
  });

  // 3) Stale-plan validation.
  const fresh = validatePlanFreshness(ctx.plan.stateVersion, ctx.currentStateVersion);
  if (!fresh.ok) {
    return gate("freshness", false, fresh.reason, true, policyResult, ctx, risk, { planVersion: ctx.plan.stateVersion, currentVersion: ctx.currentStateVersion });
  }

  // 4) Conflict detection.
  const conflict = detectConflicts(ctx.plan, ctx.mutationsSince ?? [], ctx.currentStateVersion);
  if (conflict.conflicted) {
    return gate("conflict", false, conflict.conflicts[0].reason, true, policyResult, ctx, risk, { conflicts: conflict.conflicts });
  }

  // 5) Permission + authority.
  const permission = checkPermission(ctx.permission, "execute_change");
  if (!permission.ok) {
    return gate("permission", false, permission.reason, true, policyResult, ctx, risk);
  }

  const authority = decideAuthority({
    agentLevel: ctx.permission.level,
    risk,
    reversible: risk.reversible,
    affected: ctx.plan.actions.flatMap((a) => resourcesForAction(a.type)),
    delegation: ctx.delegation ?? null,
    now: ctx.now,
    policyApprovalRequired: policyResult.approvalRequired,
  });

  if (!authority.allowed) {
    return gate("authority", false, authority.reason, true, policyResult, ctx, risk, { authority });
  }

  return gate("authority", true, authority.reason, authority.approvalRequired, policyResult, ctx, risk, {
    authority: { level: authority.level, approvalRequired: authority.approvalRequired },
  });
}

function resourcesForAction(type: string): string[] {
  const map: Record<string, string[]> = {
    increase_cache_capacity: ["cache"],
    restart_cache: ["cache"],
    scale_service: ["checkout"],
    scale_database: ["database", "queue"],
    rollback_deployment: ["api-gateway", "checkout"],
    change_configuration: ["configuration", "database"],
    restore_configuration: ["database", "cache", "api-gateway"],
    do_nothing: [],
  };
  return map[type] ?? [];
}

function gate(
  stage: GateDecision["stage"],
  allowed: boolean,
  reason: string,
  approvalRequired: boolean,
  policy: PolicyResult,
  ctx: GateContext,
  risk: ReturnType<typeof assessRisk>,
  detail?: Record<string, unknown>
): GateDecision {
  return { allowed, stage, reason, approvalRequired, policy, risk, detail };
}
