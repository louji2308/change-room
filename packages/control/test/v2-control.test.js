import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateAutonomy } from "../dist/autonomy.js";
import { RiskBudget } from "../dist/risk-budget.js";
import { prepareGate, reevaluateForExecution, gatePair, evaluateGate } from "../dist/gate.js";
import { decideAuthority } from "../dist/authority.js";
import { PolicyEngine } from "../dist/policy.js";
import { createPlan } from "@change-room/domain";

const NOW = 1_700_000_000_000;

function defaultRules() {
  return [{ id: "no-schema", forbidResources: ["schema"], reason: "schema changes forbidden" }];
}

function plan(type, stateVersion = 10) {
  return createPlan({
    name: `Plan ${type}`,
    objective: "resolve incident",
    actions: [{ type, description: type }],
    stateVersion,
    confidence: 0.8,
    risk: { overall: type === "rollback_deployment" ? "high" : "low", factors: {}, reversible: true },
    reversibility: "fully-reversible",
    policy: { allowed: true, approvalRequired: false, reason: "" },
  });
}

function stellar() {
  return {
    predictionAccuracy: 0.95,
    policyCompliance: 1,
    unsafeActionRate: 0,
    humanOverrides: 0,
    recoverySuccess: 0.95,
    rollbackFrequency: 0,
    staleStateViolations: 0,
    robustness: 0.9,
  };
}

// evaluateAutonomy
test("autonomy: upgrades a level on stellar history", () => {
  const r = evaluateAutonomy("L3", stellar());
  assert.equal(r.direction, "up");
  assert.equal(r.level, "L4");
});
test("autonomy: stays L4 at max", () => {
  const r = evaluateAutonomy("L4", stellar());
  assert.equal(r.direction, "same");
  assert.equal(r.level, "L4");
});
test("autonomy: decreases L3->L2 on prediction deviation", () => {
  const r = evaluateAutonomy("L3", { ...stellar(), predictionAccuracy: 0.6 });
  assert.equal(r.direction, "down");
  assert.equal(r.level, "L2");
  assert.ok(r.reason.some((x) => x.includes("predictionAccuracy")));
});
test("autonomy: decreases on unsafe action rate", () => {
  const r = evaluateAutonomy("L2", { ...stellar(), unsafeActionRate: 0.2 });
  assert.equal(r.direction, "down");
  assert.equal(r.level, "L1");
});
test("autonomy: decreases on stale state violation", () => {
  const r = evaluateAutonomy("L3", { ...stellar(), staleStateViolations: 2 });
  assert.equal(r.direction, "down");
  assert.equal(r.level, "L2");
});
test("autonomy: stays same when neither triggers", () => {
  const r = evaluateAutonomy("L2", { ...stellar(), predictionAccuracy: 0.8 });
  assert.equal(r.direction, "same");
  assert.equal(r.level, "L2");
});
test("autonomy: reason surfaced", () => {
  const r = evaluateAutonomy("L3", stellar());
  assert.ok(Array.isArray(r.reason));
  assert.ok(r.reason.every((x) => typeof x === "string"));
});

// RiskBudget
test("budget: spend within budget ok", () => {
  const b = new RiskBudget({ initialBudget: 10 }, { scale_service: 4 });
  const r = b.spend("scale_service");
  assert.equal(r.ok, true);
  assert.equal(r.remaining, 6);
});
test("budget: over-budget refused with reason", () => {
  const b = new RiskBudget({ initialBudget: 3 }, { scale_database: 8 });
  const r = b.spend("scale_database");
  assert.equal(r.ok, false);
  assert.equal(r.remaining, 3);
  assert.ok(r.reason.includes("insufficient"));
});
test("budget: remaining never negative", () => {
  const b = new RiskBudget({ initialBudget: 5 }, { a: 10 });
  b.spend("a");
  b.spend("a");
  assert.equal(b.remaining(), 5);
});
test("budget: default cost unknown action", () => {
  const b = new RiskBudget({ initialBudget: 2 }, {});
  const r = b.spend("unknown");
  assert.equal(r.ok, true);
  assert.equal(r.remaining, 1); // default cost 1
  const b2 = new RiskBudget({ initialBudget: 0 }, {});
  assert.equal(b2.spend("unknown").ok, false); // 0 < 1, refused
});
test("budget: reset restores initial", () => {
  const b = new RiskBudget({ initialBudget: 10 }, { a: 4 });
  b.spend("a");
  b.spend("a");
  assert.equal(b.remaining(), 2);
  b.reset();
  assert.equal(b.remaining(), 10);
});

// gates
test("gate: prepare ok but execute blocked when world advanced", () => {
  const policy = new PolicyEngine({ rules: defaultRules() });
  const budget = new RiskBudget({ initialBudget: 32 }, { increase_cache_capacity: 3 });
  const p = plan("increase_cache_capacity", 10);
  const ctx = { plan: p, currentStateVersion: 12, permission: { granted: [], level: "L4" }, delegation: null, now: NOW };
  const prepare = prepareGate(ctx, policy);
  const execute = reevaluateForExecution(ctx, policy, budget);
  assert.equal(prepare.allowed, true);
  assert.equal(execute.allowed, false);
  assert.equal(execute.stage, "freshness");
});
test("gate: prepare ok but execute blocked on budget depleted", () => {
  const policy = new PolicyEngine({ rules: defaultRules() });
  const budget = new RiskBudget({ initialBudget: 2 }, { scale_database: 8 });
  const p = plan("scale_database", 10);
  const ctx = { plan: p, currentStateVersion: 10, permission: { granted: [], level: "L4" }, delegation: null, now: NOW };
  const prepare = prepareGate(ctx, policy);
  const execute = reevaluateForExecution(ctx, policy, budget);
  assert.equal(prepare.allowed, true);
  assert.equal(execute.allowed, false);
  assert.equal(execute.stage, "budget");
});
test("gate: gatePair exposes prepare and execute", () => {
  const policy = new PolicyEngine({ rules: defaultRules() });
  const budget = new RiskBudget({ initialBudget: 32 }, { increase_cache_capacity: 3 });
  const p = plan("increase_cache_capacity", 10);
  const ctx = { plan: p, currentStateVersion: 12, permission: { granted: [], level: "L4" }, delegation: null, now: NOW };
  const { prepare, execute } = gatePair(ctx, policy, budget);
  assert.equal(prepare.allowed, true);
  assert.equal(execute.allowed, false);
});
test("evaluateGate: backward compatible prepare path", () => {
  const policy = new PolicyEngine({ rules: defaultRules() });
  const p = plan("increase_cache_capacity", 10);
  const d = evaluateGate({ plan: p, currentStateVersion: 10, permission: { granted: [], level: "L4" }, delegation: null, now: NOW }, policy);
  assert.equal(d.allowed, true);
  assert.equal(d.stage, "authority");
});

// Delegation
function grant(overrides = {}) {
  return { riskCeiling: "low", expiresAt: NOW + 10000, scope: ["cache"], approvalStillRequired: false, ...overrides };
}
test("delegation: allowedActionTypes refuses out-of-scope", () => {
  const g = grant({ allowedActionTypes: ["increase_cache_capacity"] });
  const v = decideAuthority({ agentLevel: "L4", actionType: "restart_cache", risk: { overall: "low" }, reversible: true, affected: ["cache"], delegation: g, now: NOW, policyApprovalRequired: false });
  assert.equal(v.allowed, false);
  assert.ok(v.reason.includes("allowedActionTypes"));
});
test("delegation: allowedActionTypes allows matching", () => {
  const g = grant({ allowedActionTypes: ["increase_cache_capacity"] });
  const v = decideAuthority({ agentLevel: "L4", actionType: "increase_cache_capacity", risk: { overall: "low" }, reversible: true, affected: ["cache"], delegation: g, now: NOW, policyApprovalRequired: false });
  assert.equal(v.allowed, true);
});
test("delegation: maxActions enforced when consumed", () => {
  const g = grant({ maxActions: 2, actionsConsumed: 2 });
  const v = decideAuthority({ agentLevel: "L4", actionType: "increase_cache_capacity", risk: { overall: "low" }, reversible: true, affected: ["cache"], delegation: g, now: NOW, policyApprovalRequired: false });
  assert.equal(v.allowed, false);
  assert.ok(v.reason.includes("maxActions"));
});
test("delegation: maxDurationMs enforced", () => {
  const g = grant({ maxDurationMs: 5000, createdAt: NOW - 10000 });
  const v = decideAuthority({ agentLevel: "L4", actionType: "increase_cache_capacity", risk: { overall: "low" }, reversible: true, affected: ["cache"], delegation: g, now: NOW, policyApprovalRequired: false });
  assert.equal(v.allowed, false);
  assert.ok(v.reason.includes("maxDurationMs"));
});
test("delegation: maxBlastRadius enforced", () => {
  const g = grant({ riskCeiling: "high", scope: ["cache", "database", "queue"], maxBlastRadius: 2 });
  const v = decideAuthority({ agentLevel: "L4", actionType: "scale_database", risk: { overall: "medium" }, reversible: true, affected: ["cache", "database", "queue"], delegation: g, now: NOW, policyApprovalRequired: false });
  assert.equal(v.allowed, false);
  assert.ok(v.reason.includes("maxBlastRadius"));
});
test("gate: execution blocked by delegation allowedActionTypes", () => {
  const policy = new PolicyEngine({ rules: defaultRules() });
  const budget = new RiskBudget({ initialBudget: 32 }, { increase_cache_capacity: 3, restart_cache: 2 });
  const delegation = grant({ allowedActionTypes: ["restart_cache"] });
  const p = plan("increase_cache_capacity", 10);
  const ctx = { plan: p, currentStateVersion: 10, permission: { granted: [], level: "L4" }, delegation, now: NOW };
  const execute = reevaluateForExecution(ctx, policy, budget);
  assert.equal(execute.allowed, false);
  assert.equal(execute.stage, "authority");
});
