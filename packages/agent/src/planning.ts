/**
 * Planning engine (Implementation.md §6.4; Idea.md §21, Architecture.md §7).
 *
 * Generates MULTIPLE candidate plans from the diagnosis — always including a
 * "do nothing" counterfactual and several distinct interventions. Each plan is
 * bound to the current state version so the control layer can reject stale
 * plans later. Plans are not executed here.
 */

import type { Hypothesis, IntentContract, Plan } from "@change-room/domain";
import { createPlan } from "@change-room/domain";

export interface PlanCandidate {
  name: string;
  objective: string;
  actions: Plan["actions"];
  assumptions: string[];
  cost: Plan["cost"];
  isDoNothing?: boolean;
  /** Which cause this plan targets. */
  targetCause: string;
}

/**
 * Map the top hypothesis to a family of candidate remediation plans.
 * Deterministic: given the same diagnosis, the same plans are produced.
 */
export function candidatesFor(top: Hypothesis, contract: IntentContract, stateVersion: number): PlanCandidate[] {
  const cause = top.cause.toLowerCase();
  const candidates: PlanCandidate[] = [];

  // Always present: the do-nothing counterfactual (doing nothing also has cost).
  candidates.push({
    name: "Do nothing",
    objective: "Take no action and observe further",
    actions: [{ type: "do_nothing", description: "No state change; monitor and reassess" }],
    assumptions: ["System may self-correct", "Outage is tolerable", "No unauthorized risk taken"],
    cost: "low",
    isDoNothing: true,
    targetCause: cause,
  });

  if (cause.includes("cache")) {
    candidates.push(
      {
        name: "Increase cache capacity",
        objective: "Relieve cache pressure to restore checkout",
        actions: [{ type: "increase_cache_capacity", parameters: { newCapacityGB: 30 }, description: "Raise cache capacity to 30GB" }],
        assumptions: ["Cache pressure is the primary cause", "Infrastructure can host larger cache"],
        cost: "medium",
        targetCause: cause,
      },
      {
        name: "Restart cache",
        objective: "Clear degraded cache state",
        actions: [{ type: "restart_cache", description: "Restart the cache to clear degradation" }],
        assumptions: ["Cache restart recovers capacity", "Brief cache warm-up acceptable"],
        cost: "low",
        targetCause: cause,
      }
    );
  }

  if (cause.includes("database")) {
    candidates.push(
      {
        name: "Scale database",
        objective: "Relieve database saturation",
        actions: [{ type: "scale_database", parameters: { factor: 1.5 }, description: "Scale database capacity 1.5x" }],
        assumptions: ["Database is the bottleneck", "Higher DB capacity is available"],
        cost: "high",
        targetCause: cause,
      },
      {
        name: "Tune connection pool",
        objective: "Reduce database contention via configuration",
        actions: [{ type: "change_configuration", parameters: { setting: "connectionPoolSize", value: 60 }, description: "Increase connection pool size to 60" }],
        assumptions: ["Connection pool is the limiting factor", "Configuration change is low-risk"],
        cost: "medium",
        targetCause: cause,
      }
    );
  }

  if (cause.includes("deployment")) {
    candidates.push({
      name: "Rollback deployment",
      objective: "Return to the last known-good release",
      actions: [{ type: "rollback_deployment", description: "Roll back the bad deployment" }],
      assumptions: ["The latest deployment introduced the regression", "Rollback target is healthy"],
      cost: "high",
      targetCause: cause,
    });
  }

  if (cause.includes("traffic")) {
    candidates.push({
      name: "Scale checkout service",
      objective: "Absorb elevated traffic",
      actions: [{ type: "scale_service", parameters: { service: "checkout", factor: 1.5 }, description: "Scale checkout service 1.5x" }],
      assumptions: ["Elevated traffic is driving load", "Horizontal scaling is available"],
      cost: "medium",
      targetCause: cause,
    });
  }

  if (cause.includes("queue")) {
    candidates.push({
      name: "Scale queue capacity",
      objective: "Drain the queue backlog",
      actions: [{ type: "scale_service", parameters: { service: "queue", factor: 1.5 }, description: "Increase queue processing capacity" }],
      assumptions: ["Queue backlog is transient", "Workers available to drain it"],
      cost: "medium",
      targetCause: cause,
    });
  }

  if (cause.includes("configuration")) {
    candidates.push({
      name: "Restore configuration",
      objective: "Reset drifted configuration to baseline",
      actions: [{ type: "restore_configuration", description: "Restore configuration to last baseline" }],
      assumptions: ["Configuration drifted from baseline", "Baseline config is healthy"],
      cost: "low",
      targetCause: cause,
    });
  }

  // Generic fallback: if no cause-specific plan matched, offer a sensible default set.
  if (candidates.length === 1) {
    candidates.push(
      {
        name: "Restore configuration",
        objective: "Reset any drifted configuration",
        actions: [{ type: "restore_configuration", description: "Restore configuration to baseline" }],
        assumptions: ["Configuration may have drifted"],
        cost: "low",
        targetCause: cause,
      },
      {
        name: "Scale checkout service",
        objective: "Absorb load to restore checkout availability",
        actions: [{ type: "scale_service", parameters: { service: "checkout", factor: 1.5 }, description: "Scale checkout 1.5x" }],
        assumptions: ["Load is the driver"],
        cost: "medium",
        targetCause: cause,
      }
    );
  }

  return candidates;
}

/**
 * Turn candidates into full domain `Plan` objects bound to the current state
 * version. Confidence is derived from the target hypothesis' confidence.
 */
export function buildPlans(candidates: PlanCandidate[], top: Hypothesis, stateVersion: number): Plan[] {
  return candidates.map((c, i) =>
    createPlan({
      id: `plan_${String(i + 1).padStart(2, "0")}`,
      name: c.name,
      objective: c.objective,
      actions: c.actions,
      stateVersion,
      expectedOutcome: `After ${c.name.toLowerCase()}, checkout should return toward baseline.`,
      evidence: top.supporting,
      assumptions: c.assumptions,
      confidence: c.isDoNothing ? 0.3 : Math.min(0.95, 0.4 + top.confidence),
      risk: { overall: c.cost === "high" ? "high" : c.cost === "medium" ? "medium" : "low", factors: {}, reversible: c.isDoNothing ? true : true },
      blastRadius: c.cost === "high" ? "medium" : c.cost === "medium" ? "low" : "low",
      reversibility: "fully-reversible",
      policy: { allowed: true, approvalRequired: false, reason: "" },
      requiredAuthority: c.cost === "high" ? "L3" : c.cost === "medium" ? "L2" : "L1",
      cost: c.cost,
      status: "DRAFT",
      isDoNothing: c.isDoNothing,
    })
  );
}
