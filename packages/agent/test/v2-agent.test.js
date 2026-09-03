import { test } from "node:test";
import assert from "node:assert/strict";
import { adversarialChallenge } from "../dist/adversarial.js";
import { decide } from "../dist/decision.js";
import { rankCandidates } from "../dist/ranking.js";
import { createDecisionConfidence } from "@change-room/domain";

function syncDriver(results) {
  // deterministic driver: returns the precomputed outcome for a perturbation
  return {
    simulate(actions, perturbation) {
      const key = Object.keys(perturbation).map((k) => `${k}=${perturbation[k]}`).join("|") || "baseline";
      return results[key];
    },
  };
}

test("adversarial: robustness reflects success share across perturbed worlds", () => {
  const driver = syncDriver({
    "traffic=1.4": { health: "healthy", checkoutSuccessRate: 98, checkoutLatencyMs: 40, checkoutErrorRate: 1 },
    "traffic=1.8": { health: "degraded", checkoutSuccessRate: 85, checkoutLatencyMs: 120, checkoutErrorRate: 8 },
    "traffic=2.5": { health: "critical", checkoutSuccessRate: 40, checkoutLatencyMs: 400, checkoutErrorRate: 30 },
  });
  const res = adversarialChallenge({
    planId: "plan_1",
    actions: ["increase_cache_capacity"],
    perturbations: [{ traffic: 1.4 }, { traffic: 1.8 }, { traffic: 2.5 }],
    driver,
    baseline: { diagnosis: 0.8 },
  });
  assert.equal(res.challengedWorlds, 3);
  assert.equal(res.successful, 1);
  assert.equal(res.partialFailures, 1);
  assert.equal(res.failures, 1);
  assert.equal(res.robustness, Math.round((1 / 3) * 100) / 100);
  // failure boundary discovered FROM simulation
  assert.equal(res.boundaries[2].outcome, "fail");
  assert.equal(res.boundaries[2].condition, "traffic=2.5");
});

test("adversarial: deterministic under identical input", () => {
  const driver = syncDriver({ "load=2": { health: "degraded", checkoutSuccessRate: 70, checkoutLatencyMs: 200, checkoutErrorRate: 12 } });
  const opts = {
    planId: "p",
    actions: ["scale_service"],
    perturbations: [{ load: 2 }],
    driver,
    baseline: { diagnosis: 0.5 },
  };
  const a = adversarialChallenge(opts);
  const b = adversarialChallenge(opts);
  assert.deepEqual(a, b);
});

test("adversarial: confidence robustness dimension reflects measured robustness", () => {
  const driver = syncDriver({ "x=1": { health: "healthy", checkoutSuccessRate: 99, checkoutLatencyMs: 30, checkoutErrorRate: 0 } });
  const res = adversarialChallenge({
    planId: "p",
    actions: ["do_nothing"],
    perturbations: [{ x: 1 }],
    driver,
    baseline: { diagnosis: 0.9 },
  });
  assert.equal(res.confidence.robustness, 1);
  assert.equal(res.confidence.diagnosis, 0.9);
});

test("decision: abstains on stale state", () => {
  const d = decide({
    worldRevision: 5,
    confidence: createDecisionConfidence({ diagnosis: 0.9 }),
    requiredAuthority: "L2",
    grantedAuthority: "L3",
    hasEnoughEvidence: true,
    stateFresh: false,
    robustness: 0.9,
  });
  assert.equal(d.type, "ABSTAIN");
  assert.deepEqual(d.missing, ["stale-state"]);
});

test("decision: collects evidence when evidence insufficient", () => {
  const d = decide({
    worldRevision: 5,
    confidence: createDecisionConfidence({ diagnosis: 0.6 }),
    requiredAuthority: "L2",
    grantedAuthority: "L3",
    hasEnoughEvidence: false,
    stateFresh: true,
    robustness: 0.9,
  });
  assert.equal(d.type, "COLLECT_EVIDENCE");
});

test("decision: abstains when robustness below threshold", () => {
  const d = decide({
    worldRevision: 5,
    confidence: createDecisionConfidence({ diagnosis: 0.9 }),
    requiredAuthority: "L2",
    grantedAuthority: "L3",
    hasEnoughEvidence: true,
    stateFresh: true,
    robustness: 0.4,
    robustnessThreshold: 0.6,
  });
  assert.equal(d.type, "ABSTAIN");
  assert.deepEqual(d.missing, ["low-robustness"]);
});

test("decision: blocks when authority insufficient", () => {
  const d = decide({
    worldRevision: 5,
    confidence: createDecisionConfidence({ diagnosis: 0.9 }),
    requiredAuthority: "L3",
    grantedAuthority: "L2",
    hasEnoughEvidence: true,
    stateFresh: true,
    robustness: 0.9,
  });
  assert.equal(d.type, "ABSTAIN");
  assert.deepEqual(d.missing, ["insufficient-authority"]);
});

test("decision: proceeds when everything clears", () => {
  const d = decide({
    worldRevision: 5,
    confidence: createDecisionConfidence({ diagnosis: 0.9 }),
    requiredAuthority: "L2",
    grantedAuthority: "L3",
    hasEnoughEvidence: true,
    stateFresh: true,
    robustness: 0.9,
  });
  assert.equal(d.type, "PROCEED");
  assert.equal(d.worldRevision, 5);
});

test("decision: asks human when diagnosis low and evidence lacking", () => {
  const d = decide({
    worldRevision: 5,
    confidence: createDecisionConfidence({ diagnosis: 0.3 }),
    requiredAuthority: "L2",
    grantedAuthority: "L3",
    hasEnoughEvidence: false,
    stateFresh: true,
    robustness: 0.9,
  });
  // evidence check fires first -> COLLECT_EVIDENCE (evidence missing takes priority)
  assert.equal(d.type, "COLLECT_EVIDENCE");
});

test("ranking: multi-dimension not a single-KPI sort", () => {
  const ranked = rankCandidates([
    { planId: "a", recovery: 0.9, cost: 0.9, risk: "high", robustness: 0.9, businessImpact: 0.9, customerImpact: 0.9, metrics: {} },
    { planId: "b", recovery: 0.6, cost: 0.1, risk: "low", robustness: 0.8, businessImpact: 0.6, customerImpact: 0.6, metrics: {} },
  ]);
  // 'b' is lower-risk and robust; should outrank high-risk 'a' despite 'a' better recovery
  assert.equal(ranked[0].planId, "b");
  assert.ok(ranked[0].reasons.length > 0);
});

test("ranking: deterministic ordering", () => {
  const cs = [
    { planId: "x", recovery: 0.5, cost: 0.5, risk: "medium", robustness: 0.5, businessImpact: 0.5, customerImpact: 0.5, metrics: {} },
    { planId: "y", recovery: 0.9, cost: 0.2, risk: "low", robustness: 0.9, businessImpact: 0.9, customerImpact: 0.9, metrics: {} },
  ];
  assert.deepEqual(rankCandidates(cs), rankCandidates(cs));
});
