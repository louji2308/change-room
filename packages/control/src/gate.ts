/**
 * Operation gate (Implementation.md §5, §14).
 *
 * Two distinct verdicts (§14.1):
 *  - **Prepare** — is the plan structurally valid and safe to PRESENT?
 *    (policy + risk + permission + authority).  Backward-compatible via
 *    `evaluateGate` and explicit `prepareGate`.
 *  - **Execute** — is the plan still valid, authorized, non-stale, within risk
 *    budget, and executable against the CURRENT world AT THIS MOMENT?
 *    Via `reevaluateForExecution` which re-runs the full sequence at execution
 *    time including a current-revision freshness re-check and budget check.
 */

import { PolicyEngine, type PolicyResult } from "./policy.js";
import { assessRisk, type RiskInput } from "./risk.js";
import { checkPermission, type PermissionContext } from "./permissions.js";
import { decideAuthority, type AuthorityInput, type DelegationGrant } from "./authority.js";
import { validatePlanFreshness } from "./stale-plan.js";
import { detectConflicts, type StateMutation } from "./conflict.js";
import type { AutonomyEngine } from "./autonomy.js";
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
  stage: "policy" | "risk" | "freshness" | "conflict" | "permission" | "authority" | "budget";
  reason: string;
  approvalRequired: boolean;
  policy: PolicyResult;
  risk: ReturnType<typeof assessRisk>;
  detail?: Record<string, unknown>;
};

/**
 * Minimal structural budget interface, satisfied by both `RiskBudget` and
 * `RiskBudgetManager`.  Keeps the gate decoupled from any single budget type.
 */
export interface RiskBudgetLike {
  canAfford(actionType: string): boolean;
  remaining(): number;
}

export function prepareGate(ctx: GateContext, policy: PolicyEngine): GateDecision {
  return runSequence(ctx, policy, { checkFreshness: false, checkBudget: false, budget: undefined });
}

export function reevaluateForExecution(
  ctx: GateContext,
  policy: PolicyEngine,
  budget?: RiskBudgetLike,
  autonomy?: AutonomyEngine,
  worldFingerprint?: { expected?: string; current?: string }
): GateDecision {
  return runSequence(ctx, policy, { checkFreshness: true, checkBudget: true, budget, autonomy, worldFingerprint });
}

export function gatePair(
  ctx: GateContext,
  policy: PolicyEngine,
  budget?: RiskBudgetLike,
  autonomy?: AutonomyEngine,
  worldFingerprint?: { expected?: string; current?: string }
): { prepare: GateDecision; execute: GateDecision } {
  return {
    prepare: prepareGate(ctx, policy),
    execute: reevaluateForExecution(ctx, policy, budget, autonomy, worldFingerprint),
  };
}

export function evaluateGate(ctx: GateContext, policy: PolicyEngine): GateDecision {
  return runSequence(ctx, policy, { checkFreshness: true, checkBudget: false, budget: undefined });
}

function runSequence(
  ctx: GateContext,
  policy: PolicyEngine,
  opts: {
    checkFreshness: boolean;
    checkBudget: boolean;
    budget?: RiskBudgetLike;
    autonomy?: AutonomyEngine;
    worldFingerprint?: { expected?: string; current?: string };
  }
): GateDecision {
  const policyResult = policy.evaluate(
    {
      actionType: ctx.plan.actions[0]?.type ?? "do_nothing",
      resources: ctx.plan.actions.flatMap((a) => resourcesForAction(a.type)),
      reversible:
        ctx.plan.reversibility === "fully-reversible" ||
        ctx.plan.reversibility === "partially-reversible",
      risk: ctx.plan.risk.overall,
    },
    ctx.intentContract
  );
  if (!policyResult.allowed) {
    const denyRisk = assessRisk({ affected: [], reversibility: "fully-reversible", declaredRisk: "low" });
    return gate("policy", false, policyResult.reason, true, policyResult, ctx, denyRisk);
  }

  const risk = assessRisk({
    affected: ctx.plan.actions.flatMap((a) => resourcesForAction(a.type)),
    reversibility: ctx.plan.reversibility,
    declaredRisk: ctx.plan.risk.overall,
    confidence: ctx.plan.confidence,
    stateFreshness: ctx.plan.stateVersion === ctx.currentStateVersion ? "fresh" : "stale",
    ...ctx.riskOverrides,
  });

  if (opts.checkFreshness) {
    const fresh = validatePlanFreshness(ctx.plan.stateVersion, ctx.currentStateVersion);
    if (!fresh.ok) {
      return gate("freshness", false, fresh.reason, true, policyResult, ctx, risk, {
        planVersion: ctx.plan.stateVersion,
        currentVersion: ctx.currentStateVersion,
      });
    }
  }

  const conflict = detectConflicts(ctx.plan, ctx.mutationsSince ?? [], ctx.currentStateVersion);
  if (conflict.conflicted) {
    return gate("conflict", false, conflict.conflicts[0].reason, true, policyResult, ctx, risk, {
      conflicts: conflict.conflicts,
    });
  }

  if (opts.checkBudget && opts.budget) {
    const actionType = ctx.plan.actions[0]?.type ?? "do_nothing";
    if (!opts.budget.canAfford(actionType)) {
      const remaining = opts.budget.remaining();
      return gate("budget", false, `risk budget exhausted for action '${actionType}' (remaining ${remaining})`, true, policyResult, ctx, risk, { budgetRemaining: remaining });
    }
  }

  if (opts.autonomy) {
    const actionType = ctx.plan.actions[0]?.type ?? "do_nothing";
    const perm = opts.autonomy.canPerform(actionType, risk.overall);
    if (!perm.allowed) {
      return gate("authority", false, perm.reason, true, policyResult, ctx, risk, {
        autonomyLevel: opts.autonomy.getState().level,
      });
    }
  }

  if (opts.worldFingerprint?.expected && opts.worldFingerprint?.current) {
    if (opts.worldFingerprint.expected !== opts.worldFingerprint.current) {
      return gate("freshness", false, "world fingerprint mismatch at execution time", true, policyResult, ctx, risk, {
        expected: opts.worldFingerprint.expected,
        actual: opts.worldFingerprint.current,
      });
    }
  }

  const permission = checkPermission(ctx.permission, "execute_change");
  if (!permission.ok) {
    return gate("permission", false, permission.reason, true, policyResult, ctx, risk);
  }

  const authority = decideAuthority({
    agentLevel: ctx.permission.level,
    actionType: ctx.plan.actions[0]?.type ?? "do_nothing",
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
