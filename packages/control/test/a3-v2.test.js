import { test } from "node:test";
import assert from "node:assert/strict";

import { AutonomyEngine } from "../dist/autonomy.js";
import { RiskBudgetManager } from "../dist/budget.js";
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

function outcome(overrides = {}) {
  return {
    decisionId: `d_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    worldRevision: 10,
    predictionAccuracy: 0.9,
    compliance: true,
    override: false,
    recovery: false,
    rollback: false,
    staleViolation: false,
    robustnessScore: 0.8,
    timestamp: NOW,
    ...overrides,
  };
}

function gateCtx(p, overrides = {}) {
  return {
    plan: p,
    currentStateVersion: p.stateVersion,
    permission: { granted: [], level: "L4" },
    delegation: null,
    now: NOW,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// AutonomyEngine (stateful, outcome-tracking)
// ═══════════════════════════════════════════════════════════════════════

test("AE: starts at L3 by default", () => {
  assert.equal(new AutonomyEngine().getState().level, "L3");
});

test("AE: starts at specified level", () => {
  assert.equal(new AutonomyEngine("L4").getState().level, "L4");
});

test("AE: no change with < 3 outcomes", () => {
  const eng = new AutonomyEngine("L3");
  eng.recordOutcome(outcome({ predictionAccuracy: 0.1 }));
  eng.recordOutcome(outcome({ predictionAccuracy: 0.1 }));
  assert.equal(eng.getState().level, "L3");
  assert.equal(eng.getState().lastChange, null);
});

test("AE: downgrade on avg accuracy < 0.6 (L3 -> L2)", () => {
  const eng = new AutonomyEngine("L3");
  for (let i = 0; i < 5; i++) {
    eng.recordOutcome(outcome({ predictionAccuracy: 0.3, timestamp: NOW + i }));
  }
  assert.equal(eng.getState().level, "L2");
  assert.ok(eng.getState().lastChange);
  assert.equal(eng.getState().lastChange.from, "L3");
  assert.equal(eng.getState().lastChange.to, "L2");
  assert.ok(eng.getState().lastChange.reason.includes("accuracy"));
});

test("AE: downgrade on > 2 rollbacks (L4 -> L3)", () => {
  const eng = new AutonomyEngine("L4");
  for (let i = 0; i < 3; i++) {
    eng.recordOutcome(outcome({ rollback: true, predictionAccuracy: 0.8, timestamp: NOW + i }));
  }
  eng.recordOutcome(outcome({ rollback: false, predictionAccuracy: 0.8, timestamp: NOW + 3 }));
  eng.recordOutcome(outcome({ rollback: false, predictionAccuracy: 0.8, timestamp: NOW + 4 }));
  assert.equal(eng.getState().level, "L3");
  assert.ok(eng.getState().lastChange.reason.includes("rollbacks"));
});

test("AE: downgrade on > 1 stale violation (L3 -> L2)", () => {
  const eng = new AutonomyEngine("L3");
  for (let i = 0; i < 5; i++) {
    eng.recordOutcome(outcome({ staleViolation: i < 2, predictionAccuracy: 0.9, timestamp: NOW + i }));
  }
  assert.equal(eng.getState().level, "L2");
  assert.ok(eng.getState().lastChange.reason.includes("stale"));
});

test("AE: upgrade when all compliant + accuracy > 0.8 + no rollbacks (L3 -> L4)", () => {
  const eng = new AutonomyEngine("L3");
  for (let i = 0; i < 5; i++) {
    eng.recordOutcome(outcome({ compliance: true, predictionAccuracy: 0.95, rollback: false, staleViolation: false, timestamp: NOW + i }));
  }
  assert.equal(eng.getState().level, "L4");
  assert.equal(eng.getState().lastChange.from, "L3");
  assert.equal(eng.getState().lastChange.to, "L4");
  assert.ok(eng.getState().lastChange.reason.includes("upgrade"));
});

test("AE: does not upgrade past L4", () => {
  const eng = new AutonomyEngine("L4");
  for (let i = 0; i < 5; i++) {
    eng.recordOutcome(outcome({ compliance: true, predictionAccuracy: 0.99, rollback: false, timestamp: NOW + i }));
  }
  assert.equal(eng.getState().level, "L4");
  assert.equal(eng.getState().lastChange, null);
});

test("AE: does not downgrade past L0", () => {
  const eng = new AutonomyEngine("L1");
  for (let i = 0; i < 5; i++) {
    eng.recordOutcome(outcome({ predictionAccuracy: 0.1, timestamp: NOW + i }));
  }
  assert.equal(eng.getState().level, "L0");
  for (let i = 0; i < 5; i++) {
    eng.recordOutcome(outcome({ predictionAccuracy: 0.1, timestamp: NOW + 10 + i }));
  }
  assert.equal(eng.getState().level, "L0");
});

test("AE: level changes produce reason strings", () => {
  const eng = new AutonomyEngine("L3");
  for (let i = 0; i < 5; i++) {
    eng.recordOutcome(outcome({ predictionAccuracy: 0.2, timestamp: NOW + i }));
  }
  const c = eng.getState().lastChange;
  assert.ok(typeof c.reason === "string");
  assert.ok(c.reason.length > 0);
  assert.ok(c.reason.includes("downgrade"));
});

test("AE: canPerform checks level correctly", () => {
  const l3 = new AutonomyEngine("L3");
  assert.equal(l3.canPerform("increase_cache_capacity", "low").allowed, true);
  assert.equal(l3.canPerform("increase_cache_capacity", "medium").allowed, true);
  assert.equal(l3.canPerform("scale_database", "high").allowed, false);
  assert.equal(new AutonomyEngine("L0").canPerform("increase_cache_capacity", "low").allowed, false);
});

test("AE: deterministic — same outcomes -> same level", () => {
  const e1 = new AutonomyEngine("L3");
  const e2 = new AutonomyEngine("L3");
  const outs = [outcome({ predictionAccuracy: 0.3, timestamp: 1 }), outcome({ predictionAccuracy: 0.4, timestamp: 2 }),
    outcome({ predictionAccuracy: 0.2, timestamp: 3 }), outcome({ predictionAccuracy: 0.35, timestamp: 4 }),
    outcome({ predictionAccuracy: 0.25, timestamp: 5 })];
  outs.forEach((o) => { e1.recordOutcome(o); e2.recordOutcome(o); });
  assert.equal(e1.evaluateLevel(), e2.evaluateLevel());
  assert.equal(e1.getState().level, e2.getState().level);
});

test("AE: evaluateLevel is side-effect-free", () => {
  const eng = new AutonomyEngine("L3");
  eng.evaluateLevel();
  assert.equal(eng.getState().lastChange, null);
});

// ═══════════════════════════════════════════════════════════════════════
// RiskBudgetManager
// ═══════════════════════════════════════════════════════════════════════

test("RBM: default budget is 32", () => {
  const b = new RiskBudgetManager();
  assert.equal(b.budget.total, 32);
  assert.equal(b.budget.remaining, 32);
});

test("RBM: costs are deterministic with risk multiplier", () => {
  const b = new RiskBudgetManager();
  assert.equal(b.costOf("increase_cache_capacity", "low"), 3);
  assert.equal(b.costOf("increase_cache_capacity", "medium"), Math.ceil(3 * 1.5));
  assert.equal(b.costOf("scale_database", "high"), Math.ceil(8 * 2));
  assert.equal(b.costOf("do_nothing", "low"), 0);
  assert.equal(b.costOf("unknown_action", "low"), 5);
});

test("RBM: canAfford checks without allocating", () => {
  const b = new RiskBudgetManager(10);
  assert.equal(b.canAfford("scale_database", "low"), true);
  assert.equal(b.budget.remaining, 10);
  assert.equal(b.canAfford("rollback_deployment", "high"), false);
});

test("RBM: allocate reduces remaining", () => {
  const b = new RiskBudgetManager(20);
  assert.equal(b.allocate("increase_cache_capacity", "low"), true);
  assert.equal(b.budget.allocated, 3);
  assert.equal(b.budget.remaining, 17);
});

test("RBM: allocate fails when insufficient", () => {
  const b = new RiskBudgetManager(5);
  assert.equal(b.allocate("rollback_deployment", "low"), false);
  assert.equal(b.budget.allocated, 0);
});

test("RBM: release restores budget", () => {
  const b = new RiskBudgetManager(20);
  b.allocate("increase_cache_capacity", "low");
  b.release("increase_cache_capacity", 3);
  assert.equal(b.budget.allocated, 0);
  assert.equal(b.budget.remaining, 20);
});

test("RBM: reset restores initial", () => {
  const b = new RiskBudgetManager(15);
  b.allocate("scale_service", "low");
  b.reset();
  assert.equal(b.budget.remaining, 15);
});

test("RBM: remaining() method works (RiskBudgetLike compat)", () => {
  const b = new RiskBudgetManager(10);
  assert.equal(b.remaining(), 10);
  b.allocate("restart_cache", "low");
  assert.equal(b.remaining(), 8);
});

test("RBM: canAfford with single arg defaults to low risk", () => {
  const b = new RiskBudgetManager(10);
  assert.equal(b.canAfford("scale_database"), true);
  assert.equal(b.canAfford("rollback_deployment"), false);
});

// ═══════════════════════════════════════════════════════════════════════
// gatePair with autonomy + fingerprint
// ═══════════════════════════════════════════════════════════════════════

test("gatePair: prepare ok, execute rejects stale world", () => {
  const policy = new PolicyEngine({ rules: defaultRules() });
  const budget = new RiskBudgetManager(32);
  const p = plan("increase_cache_capacity", 10);
  const { prepare, execute } = gatePair(gateCtx(p, { currentStateVersion: 12 }), policy, budget);
  assert.equal(prepare.allowed, true);
  assert.equal(execute.allowed, false);
  assert.equal(execute.stage, "freshness");
});

test("gatePair: execute rejects budget exhaustion", () => {
  const policy = new PolicyEngine({ rules: defaultRules() });
  const budget = new RiskBudgetManager(1);
  const p = plan("scale_database", 10);
  const { prepare, execute } = gatePair(gateCtx(p), policy, budget);
  assert.equal(prepare.allowed, true);
  assert.equal(execute.allowed, false);
  assert.equal(execute.stage, "budget");
});

test("gatePair: execute rejects when autonomy blocks", () => {
  const policy = new PolicyEngine({ rules: defaultRules() });
  const budget = new RiskBudgetManager(32);
  const autonomy = new AutonomyEngine("L0");
  const p = plan("increase_cache_capacity", 10);
  const { prepare, execute } = gatePair(gateCtx(p), policy, budget, autonomy);
  assert.equal(prepare.allowed, true);
  assert.equal(execute.allowed, false);
  assert.equal(execute.stage, "authority");
  assert.ok(execute.reason.includes("autonomy"));
});

test("gatePair: execute rejects on world fingerprint mismatch", () => {
  const policy = new PolicyEngine({ rules: defaultRules() });
  const budget = new RiskBudgetManager(32);
  const p = plan("increase_cache_capacity", 10);
  const fp = { expected: "abc", current: "xyz" };
  const { prepare, execute } = gatePair(gateCtx(p), policy, budget, undefined, fp);
  assert.equal(prepare.allowed, true);
  assert.equal(execute.allowed, false);
  assert.equal(execute.stage, "freshness");
  assert.ok(execute.detail);
});

test("gatePair: both pass when everything valid", () => {
  const policy = new PolicyEngine({ rules: defaultRules() });
  const budget = new RiskBudgetManager(32);
  const autonomy = new AutonomyEngine("L4");
  const p = plan("increase_cache_capacity", 10);
  const fp = { expected: "abc", current: "abc" };
  const { prepare, execute } = gatePair(gateCtx(p), policy, budget, autonomy, fp);
  assert.equal(prepare.allowed, true);
  assert.equal(execute.allowed, true);
});

// ═══════════════════════════════════════════════════════════════════════
// Delegation V2 expanded fields
// ═══════════════════════════════════════════════════════════════════════

const mkGrant = (overrides = {}) => ({
  riskCeiling: "low", expiresAt: NOW + 10000, scope: ["cache"],
  approvalStillRequired: false, humanApproved: true, ...overrides,
});

test("delegation: humanApproved=false blocks", () => {
  const v = decideAuthority({
    agentLevel: "L4", actionType: "increase_cache_capacity",
    risk: { overall: "low" }, reversible: true, affected: ["cache"],
    delegation: mkGrant({ humanApproved: false }),
    now: NOW, policyApprovalRequired: false,
  });
  assert.equal(v.allowed, false);
  assert.ok(v.reason.includes("human-approved"));
});

test("delegation: reversibilityRequirement blocks irreversible", () => {
  const v = decideAuthority({
    agentLevel: "L4", actionType: "increase_cache_capacity",
    risk: { overall: "low" }, reversible: false, affected: ["cache"],
    delegation: mkGrant({ reversibilityRequirement: "reversible-only" }),
    now: NOW, policyApprovalRequired: false,
  });
  assert.equal(v.allowed, false);
  assert.ok(v.reason.includes("reversible-only"));
});

test("evaluateGate: backward compat — includes freshness check", () => {
  const policy = new PolicyEngine({ rules: defaultRules() });
  const p = plan("increase_cache_capacity", 10);
  const d = evaluateGate(gateCtx(p, { currentStateVersion: 12 }), policy);
  assert.equal(d.allowed, false);
  assert.equal(d.stage, "freshness");
});

test("evaluateGate: passes for fresh plan", () => {
  const policy = new PolicyEngine({ rules: defaultRules() });
  const p = plan("increase_cache_capacity", 10);
  const d = evaluateGate(gateCtx(p), policy);
  assert.equal(d.allowed, true);
  assert.equal(d.stage, "authority");
});
