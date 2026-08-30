/**
 * Challenge engine (Implementation.md §Phase 13; Idea.md §31).
 *
 * Given an existing recommendation (a PLAN in PLAN_READY or SIMULATED), the
 * human can ask the agent to "try to disprove its own recommendation". This
 * module produces an evidence-grounded ChallengeReport with five fields:
 *
 *   supporting evidence
 *   counterevidence
 *   weak assumptions
 *   potential failure modes
 *   alternative plan
 *
 * Honesty rule: nothing is fabricated. Supporting evidence is traced to the
 * recorded evidence log; counterevidence is traced to recorded contradiction
 * signals and competing hypotheses; weak assumptions are those not backed by
 * evidence or relying on an unsettled diagnosis; failure modes are tied to the
 * evidence/simulation where possible. If nothing substantive is wrong, the
 * report says so honestly (countered = false, empty counterevidence).
 *
 * This is a PURE, read-only function: it never writes to state, never changes
 * permissions, and never executes or submits anything. Every mutation must go
 * through the Change Control layer elsewhere.
 */

import type { Evidence, Hypothesis, Plan } from "@change-room/domain";
import type { SimulatedPlan } from "./simulation.js";

/** Everything the challenge engine reasons over; all read-only inputs. */
export interface ChallengeContext {
  /** Every candidate plan the agent generated (the target plus alternatives). */
  plans: Plan[];
  /** Recorded evidence log (investigation.evidence). */
  evidence: Evidence[];
  /** Ranked hypothesis belief set. */
  hypotheses: Hypothesis[];
  /** The top hypothesis the target plan was built from. */
  topHypothesis?: Hypothesis;
  /** Predicted outcomes per plan (from the isolated simulation branch). */
  simulations: SimulatedPlan[];
  /** Current observed KPIs, used to judge whether a prediction improves things. */
  current?: { checkoutLatencyMs?: number; checkoutErrorRate?: number; checkoutSuccessRate?: number };
}

export interface SupportingEvidenceRef {
  evidenceId: string;
  label: string;
  metric: string;
  source: string;
}

export type CounterEvidenceOrigin = "hypothesis" | "alternative-hypothesis";

export interface CounterEvidence {
  origin: CounterEvidenceOrigin;
  label: string;
  howItWeakens: string;
  metric?: string;
}

export interface WeakAssumption {
  assumption: string;
  whyWeak: string;
  /** Recorded evidence that (partially) backs the assumption; empty if none. */
  backingEvidenceIds: string[];
}

export interface FailureMode {
  description: string;
  likelihood: "low" | "medium" | "high" | "unknown";
  /** Evidence/hypothesis/risk references this mode is tied to. */
  tiedTo: string[];
}

export interface AlternativePlan {
  name: string;
  rationale: string;
  /** This is always a read-only counterfactual for consideration, never auto-submitted. */
  counterfactualOnly: true;
}

export interface ChallengeReport {
  planId: string;
  planName: string;
  /** "countered" when meaningful counterarguments exist; "clear" otherwise. */
  verdict: "countered" | "clear";
  supportingEvidence: SupportingEvidenceRef[];
  counterevidence: CounterEvidence[];
  weakAssumptions: WeakAssumption[];
  potentialFailureModes: FailureMode[];
  alternativePlan: AlternativePlan | null;
}

export type ChallengeResult =
  | { ok: true; report: ChallengeReport }
  | { ok: false; error: string; code: string };

/** Extract a metric name from a hypothesis basis string ("label (metric=value)"). */
function metricOfBasis(s: string): string | undefined {
  const m = s.match(/\(([\w.]+)=/);
  return m ? m[1] : undefined;
}

/** An assumption is directly backed if it shares a word with the target cause. */
function assumptionBackedByCause(assumption: string, cause?: string): boolean {
  if (!cause) return false;
  const words = cause.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
  const a = assumption.toLowerCase();
  return words.some((w) => a.includes(w));
}

function buildReport(ctx: ChallengeContext, plan: Plan): ChallengeReport {
  const top = ctx.topHypothesis;

  // --- Supporting evidence: recorded evidence backing the diagnosis. ---
  const supportMetrics = new Set<string>();
  for (const b of top?.basis ?? []) {
    const metric = metricOfBasis(b);
    if (metric) supportMetrics.add(metric);
  }
  const supportingEvidence: SupportingEvidenceRef[] = ctx.evidence
    .filter((e) => supportMetrics.has(e.metric))
    .map((e) => ({ evidenceId: e.id, label: e.label, metric: e.metric, source: e.source }));

  // --- Counterevidence: recorded contradictions + competing diagnoses. ---
  const counterevidence: CounterEvidence[] = [];
  for (const label of top?.counterevidence ?? []) {
    counterevidence.push({
      origin: "hypothesis",
      label,
      howItWeakens:
        "A signal that was expected to confirm the diagnosis contradicted it, weakening the causal story this plan rests on.",
    });
  }
  if (top) {
    for (const h of ctx.hypotheses) {
      if (h.id === top.id) continue;
      if (h.confidence >= top.confidence - 0.15) {
        counterevidence.push({
          origin: "alternative-hypothesis",
          label: `${h.cause} (confidence ${h.confidence.toFixed(2)})`,
          howItWeakens: `An alternative cause '${h.cause}' has confidence competitive with the top hypothesis, so this plan may be targeting the wrong cause.`,
        });
      }
    }
  }

  // --- Weak assumptions: not backed by evidence, or rest on an unsettled diagnosis. ---
  const diagnosisUncertain = counterevidence.length > 0 || (top?.missingEvidence?.length ?? 0) > 0;
  const weakAssumptions: WeakAssumption[] = [];
  for (const a of plan.assumptions) {
    const backed = assumptionBackedByCause(a, top?.cause);
    if (!backed || diagnosisUncertain) {
      weakAssumptions.push({
        assumption: a,
        whyWeak: !backed
          ? "This assumption is not directly backed by any recorded evidence."
          : "Confidence in the underlying diagnosis is not settled, so even a nominally-backed assumption is weakly held.",
        backingEvidenceIds: supportingEvidence.map((s) => s.evidenceId),
      });
    }
  }

  // --- Potential failure modes, tied to evidence where possible. ---
  const sims = ctx.simulations.filter((s) => s.plan.id === plan.id);
  const failureModes: FailureMode[] = [];
  if (counterevidence.length > 0) {
    failureModes.push({
      description:
        "The diagnosis is contradicted or not settled, so the plan may fail to resolve the actual cause, wasting the change or leaving the incident unresolved.",
      likelihood: "medium",
      tiedTo: counterevidence.map((c) => c.label),
    });
  }
  if (sims.length === 0) {
    failureModes.push({
      description: "This plan was not simulated, so its predicted outcome is unverified.",
      likelihood: "unknown",
      tiedTo: [],
    });
  } else if (ctx.current) {
    const noLatencyGain = sims.some(
      (s) =>
        ctx.current?.checkoutLatencyMs != null &&
        s.predictedKpis?.checkoutLatencyMs != null &&
        s.predictedKpis.checkoutLatencyMs >= ctx.current.checkoutLatencyMs
    );
    if (noLatencyGain) {
      failureModes.push({
        description:
          "Simulation predicts no latency improvement, suggesting the intervention may not relieve the underlying cause.",
        likelihood: "medium",
        tiedTo: ["simulation"],
      });
    }
  }
  if (plan.risk.overall === "high") {
    failureModes.push({
      description: "High overall risk means a misdiagnosis could cause wide impact.",
      likelihood: "medium",
      tiedTo: ["risk"],
    });
  }

  // --- Alternative plan: a strictly read-only counterfactual, or null if this
  // --- plan is already the best available lower-risk option.
  const alt = ctx.plans
    .filter((p) => p.id !== plan.id && !p.isDoNothing && p.cost !== "high")
    .sort(
      (a, b) =>
        (a.risk.overall === "high" ? 1 : 0) - (b.risk.overall === "high" ? 1 : 0) ||
        a.cost.localeCompare(b.cost)
    )[0];
  const alternativePlan: AlternativePlan | null = alt
    ? {
        name: alt.name,
        rationale: `A lower-risk alternative worth considering: ${alt.actions
          .map((x) => x.description)
          .join("; ")}. This is a read-only counterfactual for consideration; it is never auto-submitted.`,
        counterfactualOnly: true,
      }
    : null;

  const verdict: ChallengeReport["verdict"] =
    counterevidence.length > 0 || weakAssumptions.length > 0 ? "countered" : "clear";

  return {
    planId: plan.id,
    planName: plan.name,
    verdict,
    supportingEvidence,
    counterevidence,
    weakAssumptions,
    potentialFailureModes: failureModes,
    alternativePlan,
  };
}

/**
 * Challenge an existing plan. Resolves the plan by id and, if found, produces a
 * pure read-only ChallengeReport. Unknown or invalid plan ids return a
 * controlled error rather than throwing.
 */
export function challengePlan(ctx: ChallengeContext, planId: string): ChallengeResult {
  const plan = ctx.plans.find((p) => p.id === planId);
  if (!plan) {
    return { ok: false, error: `unknown plan '${planId}'`, code: "UNKNOWN_PLAN" };
  }
  return { ok: true, report: buildReport(ctx, plan) };
}
