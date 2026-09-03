/**
 * Policy engine (Implementation.md §5.1; Idea.md §24).
 *
 * Answers three questions: is an action allowed? is it forbidden? is approval
 * required? Technical feasibility and authorization are separate — policy
 * concerns (technical + prohibited) rules, while authority/gate decide who may
 * act. Policy is deterministic and data-driven.
 */

import type { IntentContract } from "@change-room/domain";

export type PolicyVerdict = "allowed" | "forbidden" | "approval-required";

export interface PolicyResult {
  verdict: PolicyVerdict;
  allowed: boolean;
  approvalRequired: boolean;
  reason: string;
  /** Which rule produced the verdict (for provenance/debug). */
  matchedRules: string[];
}

export interface PolicyRule {
  id: string;
  /** Forbid (or require approval for) an action matching these criteria. */
  forbidActionTypes?: string[];
  requireApprovalFor?: string[];
  /** Forbid touching these resources. */
  forbidResources?: string[];
  /** Applies only within this scope (resource ids); empty = global. */
  scope?: string[];
  /** If true, irreversible actions are forbidden outright. */
  forbidIrreversible?: boolean;
  reason: string;
}

export interface PolicyEngineOptions {
  rules: PolicyRule[];
}

export interface OperationSubject {
  /** Operator action types (e.g. "increase_cache_capacity"). */
  actionType: string;
  /** Resources the action would touch. */
  resources: string[];
  /** Reversibility classification. */
  reversible?: boolean;
  /** Risk severity, if already computed. */
  risk?: "low" | "medium" | "high";
}

export class PolicyEngine {
  constructor(private readonly opts: PolicyEngineOptions) {}

  /** Evaluate one proposed operation against policy. */
  evaluate(subject: OperationSubject, contract?: IntentContract): PolicyResult {
    const matched: string[] = [];
    const forbiddenRoot = contract?.forbidden ?? [];

    // 1) Intent-contract-level forbidden actions (natural-language display list).
    const forbiddenActionHits = forbiddenRoot.filter((f) => f.toLowerCase() === subject.actionType.toLowerCase());
    if (forbiddenActionHits.length > 0) {
      return {
        verdict: "forbidden",
        allowed: false,
        approvalRequired: false,
        reason: `forbidden by intent contract: ${forbiddenActionHits.join(", ")}`,
        matchedRules: ["contract.forbidden"],
      };
    }

    // 1b) Structured forbidden action types (machine-readable, P0-4).
    if (contract?.forbiddenActionTypes?.some((t) => t.toLowerCase() === subject.actionType.toLowerCase())) {
      return {
        verdict: "forbidden",
        allowed: false,
        approvalRequired: false,
        reason: `forbidden by intent contract: action type ${subject.actionType}`,
        matchedRules: ["contract.forbiddenActionTypes"],
      };
    }

    // 1c) Structured forbidden resources (machine-readable, P0-4).
    if (contract?.forbiddenResources?.some((r) => subject.resources.includes(r))) {
      return {
        verdict: "forbidden",
        allowed: false,
        approvalRequired: false,
        reason: `forbidden by intent contract: resource overlap`,
        matchedRules: ["contract.forbiddenResources"],
      };
    }

    // 2) Static rules.
    for (const rule of this.opts.rules) {
      if (rule.scope && !rule.scope.some((s) => subject.resources.includes(s))) continue;

      if (rule.forbidActionTypes?.includes(subject.actionType)) {
        matched.push(rule.id);
        return {
          verdict: "forbidden",
          allowed: false,
          approvalRequired: false,
          reason: rule.reason,
          matchedRules: matched,
        };
      }

      if (rule.forbidIrreversible && subject.reversible === false) {
        matched.push(rule.id);
        return {
          verdict: "forbidden",
          allowed: false,
          approvalRequired: false,
          reason: rule.reason,
          matchedRules: matched,
        };
      }

      if (
        rule.forbidResources &&
        subject.resources.some((r) => rule.forbidResources!.includes(r))
      ) {
        matched.push(rule.id);
        return {
          verdict: "forbidden",
          allowed: false,
          approvalRequired: false,
          reason: rule.reason,
          matchedRules: matched,
        };
      }

      if (rule.requireApprovalFor?.includes(subject.actionType)) {
        matched.push(rule.id);
      }
    }

    // 3) High-risk or irreversible operations require approval by default.
    if (subject.risk === "high" || subject.reversible === false) {
      matched.push("default.high-risk");
      return {
        verdict: "approval-required",
        allowed: true,
        approvalRequired: true,
        reason: "high-risk or irreversible operation requires approval",
        matchedRules: matched,
      };
    }

    if (matched.some((m) => m !== "default.high-risk")) {
      return {
        verdict: "approval-required",
        allowed: true,
        approvalRequired: true,
        reason: "operation is flagged for approval",
        matchedRules: matched,
      };
    }

    return {
      verdict: "allowed",
      allowed: true,
      approvalRequired: false,
      reason: "operation is permitted",
      matchedRules: matched,
    };
  }
}
