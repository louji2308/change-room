/**
 * Authority engine (Implementation.md §5.4; Architecture.md §22).
 *
 * Determines whether a bounded operation may proceed, whether human approval
 * is required, and whether a temporary delegation grant covers it (and has not
 * expired). Authority is earned by context: risk, confidence, blast radius,
 * reversibility, policy, scope and duration.
 */

import { rankOf, type AuthorityLevel } from "@change-room/domain";
import { assessRisk, type RiskInput } from "./risk.js";

export interface DelegationGrant {
  /** Highest risk the delegation may cover. */
  riskCeiling: "low" | "medium" | "high";
  /** Expiry (ms epoch). */
  expiresAt: number;
  /** Resource scope. */
  scope: string[];
  /** Whether human approval is still required even under delegation. */
  approvalStillRequired: boolean;
  /** If true, only reversible operations are covered by this delegation. */
  reversibleOnly?: boolean;

  // ── V2 expanded fields (§14.2) ─────────────────────────────────────
  /** Maximum number of actions the delegation may cover. */
  maxActions?: number;
  /** Maximum wall-clock duration (ms) from grant creation. */
  maxDurationMs?: number;
  /** Max number of affected resources for a single action. */
  maxBlastRadius?: number;
  /** Whitelist of allowed action types; if present, actions outside this list are refused. */
  allowedActionTypes?: string[];
  /** Maximum aggregate cost the delegation may consume. */
  maxCost?: number;
  /** Subset of delegated actions that still require explicit human approval. */
  actionsStillRequiringApproval?: string[];
  /** Actions already consumed against this delegation grant. */
  actionsConsumed?: number;
  /** Timestamp (ms epoch) when this delegation grant was created. */
  createdAt?: number;
  /** Stricter than reversibleOnly — "any" uses reversibleOnly, "reversible-only" is explicit. */
  reversibilityRequirement?: "any" | "reversible-only";
  /** Human must have approved the grant itself. */
  humanApproved?: boolean;
}

export interface AuthorityInput {
  /** The agent's baseline authority level. */
  agentLevel: AuthorityLevel;
  /** The action type being evaluated (used for delegation allowedActionTypes check). */
  actionType?: string;
  /** Operation risk (already assessed). */
  risk: { overall: "low" | "medium" | "high" };
  /** Whether the operation is reversible. */
  reversible: boolean;
  /** Affected resources. */
  affected: string[];
  /** Bounded delegation grant, if any. */
  delegation?: DelegationGrant | null;
  /** Current time (ms epoch) for expiry checks. */
  now: number;
  /** Policy verdict. */
  policyApprovalRequired: boolean;
}

export type AuthorityVerdict =
  | { allowed: true; approvalRequired: boolean; reason: string; level: AuthorityLevel }
  | { allowed: false; reason: string };

const RISK_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

export function decideAuthority(input: AuthorityInput): AuthorityVerdict {
  const riskRank = RISK_RANK[input.risk.overall];

  // Delegation expands authority (bounded), but never past its own ceiling or scope.
  if (input.delegation) {
    const d = input.delegation;

    // Human approval of the grant itself must be explicit when the field is
    // provided (backward compatible: grants without the field are treated per V1).
    if (d.humanApproved === false) {
      return { allowed: false, reason: "delegation grant has not been human-approved" };
    }

    if (d.expiresAt <= input.now) {
      return { allowed: false, reason: "delegation grant has expired" };
    }

    if (RISK_RANK[d.riskCeiling] < riskRank) {
      return { allowed: false, reason: `operation risk (${input.risk.overall}) exceeds delegation ceiling (${d.riskCeiling})` };
    }

    if (d.scope.length > 0 && !input.affected.some((a) => d.scope.includes(a))) {
      return { allowed: false, reason: "affected resources are outside delegation scope" };
    }

    // V2: reversibility requirement (strict form).
    if (d.reversibilityRequirement === "reversible-only" && !input.reversible) {
      return { allowed: false, reason: "delegation requires reversible-only operations" };
    }
    // V1: reversibleOnly field (kept for backward compat).
    if (d.reversibleOnly && !input.reversible) {
      return { allowed: false, reason: "delegation only covers reversible operations" };
    }

    // V2: maxBlastRadius.
    if (d.maxBlastRadius !== undefined && input.affected.length > d.maxBlastRadius) {
      return { allowed: false, reason: `affected resources (${input.affected.length}) exceed delegation maxBlastRadius (${d.maxBlastRadius})` };
    }

    // V2: maxActions — refuse when consumed count meets or exceeds the cap.
    if (d.maxActions !== undefined) {
      const consumed = d.actionsConsumed ?? 0;
      if (consumed >= d.maxActions) {
        return { allowed: false, reason: `delegation maxActions ${d.maxActions} already consumed (${consumed})` };
      }
    }

    // V2: maxDurationMs — refuse when wall-clock duration exceeds the cap.
    if (d.maxDurationMs !== undefined && d.createdAt !== undefined) {
      const elapsed = input.now - d.createdAt;
      if (elapsed > d.maxDurationMs) {
        return { allowed: false, reason: `delegation maxDurationMs ${d.maxDurationMs} exceeded (elapsed ${elapsed}ms)` };
      }
    }

    // V2: allowedActionTypes — refuse when an action type is provided and it
    // is not in the whitelist.  When no actionType is supplied we cannot verify,
    // so the whitelist is treated as permissive (the gate supplies actionType).
    if (d.allowedActionTypes && d.allowedActionTypes.length > 0 && input.actionType) {
      if (!d.allowedActionTypes.includes(input.actionType)) {
        return { allowed: false, reason: `action type '${input.actionType}' is not in delegation allowedActionTypes [${d.allowedActionTypes.join(", ")}]` };
      }
    }

    // Determine approval: either the delegation always requires it,
    // or this specific action type is in the still-requiring-approval list.
    let approvalRequired = d.approvalStillRequired;
    if (!approvalRequired && d.actionsStillRequiringApproval) {
      if (input.actionType && d.actionsStillRequiringApproval.includes(input.actionType)) {
        approvalRequired = true;
      }
    }

    return {
      allowed: true,
      approvalRequired,
      reason: "covered by bounded delegation",
      level: input.agentLevel,
    };
  }

  // Without delegation, authority is granted by agent level + risk.
  const level = rankOf(input.agentLevel);
  if (riskRank >= 2) {
    // high risk: never autonomous; only L3+ may attempt, always requiring approval.
    if (level < 3) return { allowed: false, reason: "high-risk operation requires L3+ and approval" };
    return { allowed: true, approvalRequired: true, reason: "high-risk requires human approval", level: input.agentLevel };
  }

  if (input.policyApprovalRequired) {
    if (level < 3) return { allowed: false, reason: "policy requires approval; agent level too low" };
    return { allowed: true, approvalRequired: true, reason: "policy requires approval", level: input.agentLevel };
  }

  if (riskRank === 0 && level >= 4 && input.reversible) {
    return { allowed: true, approvalRequired: false, reason: "low-risk reversible L4 action", level: input.agentLevel };
  }

  if (level >= 3) {
    return { allowed: true, approvalRequired: true, reason: "executes with approval at L3", level: input.agentLevel };
  }

  return { allowed: false, reason: `agent level ${input.agentLevel} cannot execute` };
}
