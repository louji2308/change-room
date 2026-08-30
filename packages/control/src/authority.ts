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
}

export interface AuthorityInput {
  /** The agent's baseline authority level. */
  agentLevel: AuthorityLevel;
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
    if (input.delegation.expiresAt <= input.now) {
      return { allowed: false, reason: "delegation grant has expired" };
    }
    if (RISK_RANK[input.delegation.riskCeiling] < riskRank) {
      return { allowed: false, reason: `operation risk (${input.risk.overall}) exceeds delegation ceiling (${input.delegation.riskCeiling})` };
    }
    if (input.delegation.scope.length > 0 && !input.affected.some((a) => input.delegation!.scope.includes(a))) {
      return { allowed: false, reason: "affected resources are outside delegation scope" };
    }
    return {
      allowed: true,
      approvalRequired: input.delegation.approvalStillRequired,
      reason: "covered by bounded delegation",
      level: input.agentLevel,
    };
  }

  // Without delegation, authority is granted by agent level + risk.
  // L3 can execute-with-approval for low/medium risk; L4 can do low risk autonomously.
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
