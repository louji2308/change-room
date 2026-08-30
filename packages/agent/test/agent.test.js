import { test } from "node:test";
import assert from "node:assert/strict";

import { parseIntent } from "../dist/intent.js";
import { investigate } from "../dist/investigation.js";
import { formHypotheses } from "../dist/hypotheses.js";
import { candidatesFor, buildPlans } from "../dist/planning.js";
import { decideRecovery } from "../dist/recovery.js";
import { challengePlan } from "../dist/challenge.js";
import { AgentOrchestrator } from "../dist/orchestrator.js";
import { WorldSimulator } from "@change-room/simulator";
import { ScenarioRunner } from "@change-room/scenarios";

// --- Intent parser ---
test("intent parser extracts priorities and constraints", () => {
  const c = parseIntent("Restore checkout safely. Availability is more important than cost. No production changes without my approval.");
  assert.ok(c.priorities.includes("availability"));
  assert.ok(c.priorities.includes("safety"));
  assert.equal(c.defaultAuthority, "L0");
  assert.ok(c.constraints.some((s) => s.includes("approval")));
});

test("intent parser defaults to availability when nothing matches", () => {
  const c = parseIntent("make things work again");
  assert.ok(c.priorities.includes("availability"));
});

test("intent parser captures forbidden schema changes", () => {
  const c = parseIntent("fix it but never make database schema changes");
  assert.ok(c.forbidden.includes("database schema changes"));
});

// --- Investigation ---
function makeView(health, overrides = {}) {
  return {
    timestamp: 100,
    health,
    blind: true,
    kpis: {
      checkoutLatencyMs: 480,
      checkoutErrorRate: 12,
      checkoutSuccessRate: 88,
      ordersThroughputPerSec: 200,
      cacheHitRateEstimate: 25,
      systemHealth: health,
      ...overrides,
    },
    metrics: [
      { componentId: "checkout", utilization: 60, latencyMs: 480, errorRate: 12, queueDepth: 3, degraded: true },
      { componentId: "cache", utilization: 96, latencyMs: 20, errorRate: 0, queueDepth: 0, degraded: true },
      { componentId: "database", utilization: 40, latencyMs: 30, errorRate: 0, queueDepth: 0, degraded: false },
    ],
    logs: [{ time: 99, type: "latency_spike", componentId: "checkout" }],
  };
}

test("investigate collects evidence with trust and relevance", () => {
  const res = investigate(makeView("degraded"), 7);
  assert.ok(res.evidence.length >= 4);
  assert.ok(res.evidence.every((e) => e.trust === "trusted-system"));
  assert.equal(res.observation.stateVersion, 7);
  assert.equal(res.observation.components.length, 3);
});

// --- Hypotheses ---
test("hypotheses rank cache degradation first when cache miss is high", () => {
  const inv = investigate(makeView("down"), 7);
  const hyps = formHypotheses({ evidence: inv.evidence, observation: inv.observation });
  assert.ok(hyps.length >= 3);
  assert.equal(hyps[0].cause, "cache degradation");
});

test("hypotheses retain uncertainty (not all-or-nothing)", () => {
  const inv = investigate(makeView("degraded"), 7);
  const hyps = formHypotheses({ evidence: inv.evidence, observation: inv.observation });
  const top = hyps[0];
  assert.ok(top.confidence > 0 && top.confidence <= 1);
  assert.ok(top.confidence < 1);
});

// --- Planning ---
test("planning always includes do-nothing plus interventions", () => {
  const contract = parseIntent("Restore checkout safely");
  const hyps = formHypotheses({ evidence: investigate(makeView("down"), 7).evidence, observation: investigate(makeView("down"), 7).observation });
  const candidates = candidatesFor(hyps[0], contract, 7);
  assert.ok(candidates.some((c) => c.isDoNothing));
  assert.ok(candidates.length >= 2);
});

test("built plans bind to state version", () => {
  const contract = parseIntent("Restore checkout safely");
  const plans = buildPlans(
    [{ name: "A", objective: "x", actions: [{ type: "increase_cache_capacity", description: "bump" }], assumptions: [], cost: "low", targetCause: "cache degradation" }],
    { cause: "cache degradation", confidence: 0.8, supporting: [], counterevidence: [], missingEvidence: [], status: "supported", basis: [] },
    42
  );
  assert.equal(plans[0].stateVersion, 42);
  assert.equal(plans[0].status, "DRAFT");
});

// --- Recovery ---
test("recovery continues on healthy verified outcome", () => {
  const d = decideRecovery({ verdict: "HEALTHY", recovered: true, reversible: true, budgetRemaining: true, predictionBad: false });
  assert.equal(d.action, "continue");
});

test("recovery rolls back a regression when reversible", () => {
  const d = decideRecovery({ verdict: "REGRESSION", recovered: false, reversible: true, budgetRemaining: true, predictionBad: true });
  assert.equal(d.action, "rollback");
});

test("recovery escalates a non-reversible regression", () => {
  const d = decideRecovery({ verdict: "REGRESSION", recovered: false, reversible: false, budgetRemaining: true, predictionBad: true });
  assert.equal(d.action, "escalate");
});

// --- End-to-end reasoning on a BLIND scenario (no ground truth) ---
test("agent reasons over a blind cache-failure scenario end to end", () => {
  // Set up the hidden scenario; we only ever touch agentView().
  const runner = ScenarioRunner.setup("cache-failure");
  runner.start();
  runner.settle(45);

  const view = runner.agentView();
  // Blindness: the agent-facing view must not leak the hidden causal fields.
  assert.equal(view.blind, true);
  const serialized = JSON.stringify(view);
  assert.ok(!/\bseed\b/.test(serialized));
  assert.ok(!/\bdisturbances?\b/.test(serialized));
  assert.ok(!/\bcause\b/.test(serialized));
  assert.ok(!/scenario-(id)?/.test(serialized));

  // Prediction world comes from a fresh simulator (same seed via scenario).
  const sim = new WorldSimulator({ seed: 1234, scenario: "random", disturbances: [] });
  sim.runBaseline(10);

  const agent = new AgentOrchestrator({
    sim,
    currentStateVersion: () => 1,
  });

  const contract = agent.setIntent("Restore checkout safely. Availability over cost. No production changes without approval.");
  const inv = agent.investigate(view);
  const hyps = agent.hypothesize();
  const { plans } = agent.generatePlans();

  assert.ok(inv.evidence.length >= 4);
  assert.ok(hyps.length >= 3);
  assert.ok(plans.some((p) => p.actions[0].type === "do_nothing"));
  assert.equal(hyps[0].confidence > 0.3, true);

  // The ground truth must remain hidden from the agent's reasoning surface.
  const gt = runner.groundTruth(); // admin-only accessor for evaluation
  assert.equal(gt.scenarioId, "cache-failure");
});

// --- Agent Challenge Mode (Phase 13) ---
function evidence(id, metric, label) {
  return { id, label, metric, value: 25, source: "metrics", timestamp: 100, relevance: 0.9, trust: "trusted-system", uncertainty: 0.1 };
}

function cacheHypothesis(conf = 0.8) {
  return {
    id: "hyp_cache",
    cause: "cache degradation",
    confidence: conf,
    supporting: ["cache hit rate dropped"],
    counterevidence: ["database utilization high contradicted"],
    missingEvidence: ["queue depth growing"],
    status: "supported",
    basis: ["cache hit rate dropped (cacheHitRateEstimate=25)"],
  };
}

function configHypothesis(conf = 0.7) {
  return {
    id: "hyp_config",
    cause: "configuration regression",
    confidence: conf,
    supporting: ["database engaged"],
    counterevidence: [],
    missingEvidence: [],
    status: "supported",
    basis: [],
  };
}

function plan(id, name, assumptions, overrides = {}) {
  return {
    id,
    name,
    objective: "restore checkout",
    actions: [{ type: "increase_cache_capacity", parameters: { newCapacityGB: 30 }, description: "Raise cache capacity" }],
    stateVersion: 7,
    expectedOutcome: "checkout returns toward baseline",
    evidence: ["cache hit rate dropped"],
    assumptions,
    confidence: 0.8,
    risk: { overall: "medium", factors: {}, reversible: true },
    blastRadius: "low",
    reversibility: "fully-reversible",
    policy: { allowed: true, approvalRequired: false, reason: "" },
    requiredAuthority: "L2",
    cost: "medium",
    status: "SIMULATED",
    isDoNothing: false,
    createdAt: 1,
    ...overrides,
  };
}

const DATA_ACCESS = {
  evidence: [
    evidence("ev_cache_hit", "cacheHitRateEstimate", "Cache hit rate estimate"),
    evidence("ev_db_util", "database.utilization", "Database utilization high"),
  ],
  hypotheses: [cacheHypothesis(), configHypothesis()],
  top: cacheHypothesis(),
  plans: (assumptions = ["Cache pressure is the primary cause", "Infrastructure can host larger cache"]) => [
    plan("plan_cache", "Increase cache capacity", assumptions),
    plan("plan_restart", "Restart cache", ["Cache restart recovers capacity"], { cost: "low", risk: { overall: "low", factors: {}, reversible: true } }),
  ],
};

test("challenge produces counterevidence + weak assumptions for a materially weak plan", () => {
  const ps = DATA_ACCESS.plans();
  const res = challengePlan(
    { plans: ps, evidence: DATA_ACCESS.evidence, hypotheses: DATA_ACCESS.hypotheses, topHypothesis: DATA_ACCESS.top, simulations: [] },
    "plan_cache"
  );
  assert.equal(res.ok, true);
  const report = res.report;
  assert.equal(report.verdict, "countered");
  // Recorded contradiction from the top hypothesis + competitive alternative cause.
  assert.ok(report.counterevidence.length >= 2, "expected meaningful counterevidence");
  assert.ok(
    report.counterevidence.some((c) => c.origin === "hypothesis"),
    "counterevidence must include the recorded contradicted signal"
  );
  assert.ok(
    report.counterevidence.some((c) => c.origin === "alternative-hypothesis"),
    "counterevidence must surface the competing diagnosis"
  );
  // Weak assumptions: not backed by evidence / rest on unsettled diagnosis.
  assert.ok(report.weakAssumptions.length >= 1, "expected at least one weak assumption");
  for (const w of report.weakAssumptions) {
    assert.equal(typeof w.assumption, "string");
    assert.equal(typeof w.whyWeak, "string");
    assert.ok(Array.isArray(w.backingEvidenceIds));
  }
  assert.ok(report.potentialFailureModes.length >= 1, "expected at least one failure mode");
});

test("challenge honestly reports 'none found' when the plan has no discovered weakness", () => {
  const cleanHyp = {
    id: "hyp_clean",
    cause: "cache degradation",
    confidence: 0.85,
    supporting: ["cache hit rate dropped"],
    counterevidence: [],
    missingEvidence: [],
    status: "supported",
    basis: ["cache hit rate dropped (cacheHitRateEstimate=25)"],
  };
  const ps = [
    plan("plan_clean", "Increase cache capacity", ["Cache pressure is the primary cause"]),
    plan("plan_nothing", "Do nothing", ["Do nothing"], { isDoNothing: true, cost: "low", risk: { overall: "low", factors: {}, reversible: true } }),
  ];
  const res = challengePlan(
    { plans: ps, evidence: [evidence("ev_cache_hit", "cacheHitRateEstimate", "Cache hit rate estimate")], hypotheses: [cleanHyp], topHypothesis: cleanHyp, simulations: [] },
    "plan_clean"
  );
  assert.equal(res.ok, true);
  const report = res.report;
  assert.equal(report.verdict, "clear");
  assert.equal(report.counterevidence.length, 0, "no counterevidence found -> none found honestly");
  assert.equal(report.weakAssumptions.length, 0, "no weak assumptions found -> none found honestly");
  // The plan is already the best lower-risk option -> no counterfactual alternative.
  assert.equal(report.alternativePlan, null);
});

test("challenge is pure: it never mutates the context (state or permissions)", () => {
  const ps = DATA_ACCESS.plans();
  const ctx = {
    plans: ps,
    evidence: DATA_ACCESS.evidence,
    hypotheses: DATA_ACCESS.hypotheses,
    topHypothesis: DATA_ACCESS.top,
    simulations: [],
  };
  const before = JSON.stringify(JSON.parse(JSON.stringify(ctx)));
  challengePlan(ctx, "plan_cache");
  challengePlan(ctx, "does-not-exist");
  const after = JSON.stringify(ctx);
  assert.equal(after, before, "challenge must not alter any state it is given");
});

test("challenge returns a controlled error for an unknown/absent planId", () => {
  const ps = DATA_ACCESS.plans();
  const res = challengePlan(
    { plans: ps, evidence: DATA_ACCESS.evidence, hypotheses: DATA_ACCESS.hypotheses, topHypothesis: DATA_ACCESS.top, simulations: [] },
    "plan_does_not_exist"
  );
  assert.equal(res.ok, false);
  assert.equal(res.code, "UNKNOWN_PLAN");
  assert.match(res.error, /unknown plan/);
});

test("challenge failure modes are tied to recorded data and simulation", () => {
  const ps = [plan("plan_cache", "Increase cache capacity", ["Cache pressure is the primary cause"])];
  const sims = [
    {
      plan: ps[0],
      actionType: "increase_cache_capacity",
      parameters: {},
      prediction: null,
      predictedKpis: { checkoutLatencyMs: 480, checkoutErrorRate: 12, checkoutSuccessRate: 88 },
    },
  ];
  const res = challengePlan(
    { plans: ps, evidence: DATA_ACCESS.evidence, hypotheses: DATA_ACCESS.hypotheses, topHypothesis: DATA_ACCESS.top, simulations: sims, current: { checkoutLatencyMs: 480, checkoutErrorRate: 12 } },
    "plan_cache"
  );
  assert.equal(res.ok, true);
  assert.ok(
    res.report.potentialFailureModes.some((f) => f.tiedTo.includes("simulation")),
    "a simulated-but-unimproved plan should surface a simulation-tied failure mode"
  );
});
