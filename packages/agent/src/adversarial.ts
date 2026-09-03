/**
 * Adversarial self-challenge (implementation-v2.md §9).
 *
 * Beyond the V1 "identify possible risks", this actively searches for
 * conditions under which the recommended plan fails, partially fails, or
 * becomes unsafe. The preferred plan's action sequence is simulated under
 * multiple perturbed worlds; failure boundaries come FROM simulation, never
 * from invented prose.
 *
 * PURE and read-only: it never mutates any world or state.
 */

import { createDecisionConfidence, type DecisionConfidence } from "@change-room/domain";

export type Perturbation = Record<string, number>;

/** A deterministic driver the caller injects: runs an action sequence against
 *  a (possibly perturbed) world and returns the resulting health + KPIs. */
export interface FutureDriver {
  simulate(actions: string[], perturbation: Perturbation): FutureOutcome;
}

export interface FutureOutcome {
  health: "healthy" | "degraded" | "critical" | "recovered";
  checkoutSuccessRate: number;
  checkoutLatencyMs: number;
  checkoutErrorRate: number;
}

export interface AdversarialChallengeOptions {
  planId: string;
  /** The preferred plan's action sequence. */
  actions: string[];
  /** Alternate environmental/parameter conditions to attack the plan under. */
  perturbations: Perturbation[];
  driver: FutureDriver;
  /** Baseline confidence dimensions to preserve (defaults to 0.5). */
  baseline?: Partial<DecisionConfidence> & { diagnosis: number };
  /** success threshold (checkoutSuccessRate %) below which a world is a failure. */
  successThreshold?: number;
  /** partial threshold (checkoutSuccessRate %) below which a world is partial. */
  partialThreshold?: number;
}

export interface ChallengedWorld {
  condition: string;
  outcome: "success" | "partial" | "fail";
  successRate: number;
}

export interface AdversarialChallengeResult {
  planId: string;
  challengedWorlds: number;
  successful: number;
  partialFailures: number;
  failures: number;
  /** 0..1 = successful / challengedWorlds */
  robustness: number;
  boundaries: ChallengedWorld[];
  confidence: DecisionConfidence;
  summary: string;
}

function describePerturbation(p: Perturbation): string {
  const parts = Object.entries(p).map(([k, v]) => `${k}=${v}`);
  return parts.length ? parts.join(" AND ") : "baseline";
}

function classify(successRate: number, successThreshold: number, partialThreshold: number): "fail" | "partial" | "success" {
  if (successRate < partialThreshold) return "fail";
  if (successRate < successThreshold) return "partial";
  return "success";
}

/** Adversarially challenge a preferred plan across perturbed worlds. */
export function adversarialChallenge(opts: AdversarialChallengeOptions): AdversarialChallengeResult {
  const successThreshold = opts.successThreshold ?? 95;
  const partialThreshold = opts.partialThreshold ?? 80;

  const boundaries: ChallengedWorld[] = opts.perturbations.map((perturbation) => {
    const out = opts.driver.simulate(opts.actions, perturbation);
    const outcome = classify(out.checkoutSuccessRate, successThreshold, partialThreshold);
    return {
      condition: describePerturbation(perturbation),
      outcome,
      successRate: Math.round(out.checkoutSuccessRate * 10) / 10,
    };
  });

  const challenged = boundaries.length;
  const successful = boundaries.filter((b) => b.outcome === "success").length;
  const partialFailures = boundaries.filter((b) => b.outcome === "partial").length;
  const failures = boundaries.filter((b) => b.outcome === "fail").length;
  const robustness = challenged === 0 ? 0 : successful / challenged;

  // Robustness dimension reflects measured robustness; preserve caller's other
  // confidence dimensions (diagnosis required).
  const confidence = createDecisionConfidence({
    diagnosis: opts.baseline?.diagnosis ?? 0.5,
    evidence: opts.baseline?.evidence ?? 0.5,
    action: opts.baseline?.action ?? 0.5,
    prediction: opts.baseline?.prediction ?? 0.5,
    policy: opts.baseline?.policy ?? 0.5,
    stateFreshness: opts.baseline?.stateFreshness ?? 0.5,
    robustness,
  });

  return {
    planId: opts.planId,
    challengedWorlds: challenged,
    successful,
    partialFailures,
    failures,
    robustness: Math.round(robustness * 100) / 100,
    boundaries,
    confidence,
    summary: `plan ${opts.planId} challenged under ${challenged} worlds: ${successful} success, ${partialFailures} partial, ${failures} fail (robustness ${(robustness * 100).toFixed(0)}%)`,
  };
}
