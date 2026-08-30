import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createIntentContract,
  createHypothesis,
  createPlan,
  overallRisk,
  workflowStatus,
  canToolInState,
  canCapability,
} from "../dist/index.js";

test("intent contract carries goal, priorities, forbidden", () => {
  const c = createIntentContract({
    goal: "Restore checkout safely",
    priorities: ["availability", "safety"],
    constraints: ["no production change without approval"],
    forbidden: ["database schema changes"],
  });
  assert.equal(c.goal, "Restore checkout safely");
  assert.ok(c.forbidden.includes("database schema changes"));
});

test("hypothesis holds confidence and status", () => {
  const h = createHypothesis({ cause: "cache degradation", confidence: 0.81 });
  assert.equal(h.confidence, 0.81);
  assert.equal(h.status, "proposed");
});

test("overallRisk collapses factors deterministically", () => {
  assert.equal(overallRisk({ blastRadius: "low", userImpact: "low", reversibility: "fully-reversible" }), "low");
  assert.equal(overallRisk({ blastRadius: "high", userImpact: "high", reversibility: "irreversible" }), "high");
});

test("plan binds to a state version for stale detection", () => {
  const p = createPlan({
    name: "Increase cache",
    objective: "restore checkout",
    actions: [{ type: "increase_cache_capacity", description: "bump cache" }],
    stateVersion: 1847,
  });
  assert.equal(p.stateVersion, 1847);
  assert.equal(p.status, "DRAFT");
});

test("workflow exposes capabilities and state awareness", () => {
  assert.ok(workflowStatus("INVESTIGATING").available.includes("generate_plans"));
  assert.equal(canToolInState("INVESTIGATING", "execute_change"), false);
  assert.equal(canToolInState("APPROVED", "execute_change"), true);
});

test("authority levels are progressive", () => {
  assert.equal(canCapability("L0", "observe"), true);
  assert.equal(canCapability("L3", "execute-with-approval"), true);
  assert.equal(canCapability("L2", "execute-with-approval"), false);
});
