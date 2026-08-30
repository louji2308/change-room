import { test } from "node:test";
import assert from "node:assert/strict";

import { parseIntent } from "../dist/intent.js";
import { investigate } from "../dist/investigation.js";
import { formHypotheses } from "../dist/hypotheses.js";
import { candidatesFor, buildPlans } from "../dist/planning.js";
import { decideRecovery } from "../dist/recovery.js";
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
