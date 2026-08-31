import { test } from "node:test";
import assert from "node:assert/strict";

import { PolicyEngine } from "../dist/policy.js";
import { assessRisk } from "../dist/risk.js";
import { checkPermission } from "../dist/permissions.js";
import { decideAuthority } from "../dist/authority.js";
import { validatePlanFreshness } from "../dist/stale-plan.js";
import { detectConflicts } from "../dist/conflict.js";
import { evaluateGate } from "../dist/gate.js";
import { createPlan } from "@change-room/domain";

const NOW = 1_700_000_000_000;

function defaultRules() {
  return [
    { id: "no-schema", forbidResources: ["schema"], reason: "schema changes forbidden" },
    { id: "approve-prod-change", requireApprovalFor: ["change_configuration"], reason: "production config requires approval" },
  ];
}

function plan(type, stateVersion = 10) {
  return createPlan({
    name: `Plan ${type}`,
    objective: "resolve incident",
    actions: [{ type, description: type }],
    stateVersion,
    confidence: 0.8,
    risk: { overall: type === "rollback_deployment" ? "high" : type === "scale_database" ? "medium" : "low", factors: {}, reversible: true },
    reversibility: "fully-reversible",
    policy: { allowed: true, approvalRequired: false, reason: "" },
  });
}

// --- Policy engine ---
test("policy forbids schema resource changes", () => {
  const p = new PolicyEngine({ rules: defaultRules() });
  const res = p.evaluate({ actionType: "change_configuration", resources: ["schema"], reversible: true });
  assert.equal(res.verdict, "forbidden");
  assert.equal(res.allowed, false);
});

test("policy requires approval for production config change", () => {
  const p = new PolicyEngine({ rules: defaultRules() });
  const res = p.evaluate({ actionType: "change_configuration", resources: ["configuration", "database"], reversible: true });
  assert.equal(res.verdict, "approval-required");
  assert.equal(res.approvalRequired, true);
});

test("policy flags high-risk operation for approval", () => {
  const p = new PolicyEngine({ rules: [] });
  const res = p.evaluate({ actionType: "scale_service", resources: ["checkout"], reversible: true, risk: "high" });
  assert.equal(res.approvalRequired, true);
});

// --- Risk engine ---
test("risk engine yields multi-axis, deterministic assessment", () => {
  const low = assessRisk({ affected: ["cache"], reversibility: "fully-reversible", confidence: 0.9, stateFreshness: "fresh" });
  const high = assessRisk({ affected: ["database", "checkout", "payment", "orders"], reversibility: "irreversible", confidence: 0.4 });
  assert.equal(low.overall, "low");
  assert.equal(high.overall, "high");
  assert.equal(high.reversible, false);
});

// --- Permission engine ---
test("permission is level-aware", () => {
  assert.equal(checkPermission({ granted: [], level: "L0" }, "observe").ok, true);
  assert.equal(checkPermission({ granted: [], level: "L0" }, "execute_change").ok, false);
  assert.equal(checkPermission({ granted: [], level: "L3" }, "execute_change").ok, true);
});

// --- Authority engine ---
test("authority: L0 cannot execute", () => {
  const v = decideAuthority({ agentLevel: "L0", risk: { overall: "low" }, reversible: true, affected: ["cache"], delegation: null, now: NOW, policyApprovalRequired: false });
  assert.equal(v.allowed, false);
});

test("authority: L4 executes low-risk reversible autonomously", () => {
  const v = decideAuthority({ agentLevel: "L4", risk: { overall: "low" }, reversible: true, affected: ["cache"], delegation: null, now: NOW, policyApprovalRequired: false });
  assert.equal(v.allowed, true);
  assert.equal(v.approvalRequired, false);
});

test("authority: L3 executes medium-risk with approval", () => {
  const v = decideAuthority({ agentLevel: "L3", risk: { overall: "medium" }, reversible: true, affected: ["checkout"], delegation: null, now: NOW, policyApprovalRequired: false });
  assert.equal(v.allowed, true);
  assert.equal(v.approvalRequired, true);
});

test("authority: high risk blocked below L3", () => {
  const v = decideAuthority({ agentLevel: "L2", risk: { overall: "high" }, reversible: true, affected: ["checkout"], delegation: null, now: NOW, policyApprovalRequired: false });
  assert.equal(v.allowed, false);
});

test("authority: expired delegation refuses", () => {
  const grant = { riskCeiling: "low", expiresAt: NOW - 1, scope: ["cache"], approvalStillRequired: true };
  const v = decideAuthority({ agentLevel: "L4", risk: { overall: "low" }, reversible: true, affected: ["cache"], delegation: grant, now: NOW, policyApprovalRequired: false });
  assert.equal(v.allowed, false);
});

test("authority: delegation beyond scope refuses", () => {
  const grant = { riskCeiling: "low", expiresAt: NOW + 1000, scope: ["cache"], approvalStillRequired: true };
  const v = decideAuthority({ agentLevel: "L4", risk: { overall: "low" }, reversible: true, affected: ["database"], delegation: grant, now: NOW, policyApprovalRequired: false });
  assert.equal(v.allowed, false);
});

// --- Phase 12: bounded delegation (reversibility requirement) ---
test("authority: delegation reversible-only refuses an irreversible operation", () => {
  const grant = { riskCeiling: "low", expiresAt: NOW + 1000, scope: ["cache"], approvalStillRequired: false, reversibleOnly: true };
  const v = decideAuthority({ agentLevel: "L4", risk: { overall: "low" }, reversible: false, affected: ["cache"], delegation: grant, now: NOW, policyApprovalRequired: false });
  assert.equal(v.allowed, false);
});

test("authority: delegation reversible-only allows a reversible operation", () => {
  const grant = { riskCeiling: "low", expiresAt: NOW + 1000, scope: ["cache"], approvalStillRequired: false, reversibleOnly: true };
  const v = decideAuthority({ agentLevel: "L4", risk: { overall: "low" }, reversible: true, affected: ["cache"], delegation: grant, now: NOW, policyApprovalRequired: false });
  assert.equal(v.allowed, true);
});

// --- Stale plan ---
test("stale plan is rejected when state version advances", () => {
  const fresh = validatePlanFreshness(10, 10);
  const stale = validatePlanFreshness(10, 11);
  assert.equal(fresh.ok, true);
  assert.equal(stale.ok, false);
  assert.equal(stale.stale, true);
});

// --- Conflict detection ---
test("concurrent human change on a plan resource conflicts", () => {
  const p = plan("increase_cache_capacity", 10);
  const conflict = detectConflicts(p, [{ resource: "cache", actor: "human", version: 11, timestamp: NOW }], 11);
  assert.equal(conflict.conflicted, true);
});

test("unrelated change does not conflict", () => {
  const p = plan("increase_cache_capacity", 10);
  const conflict = detectConflicts(p, [{ resource: "inventory", actor: "human", version: 11, timestamp: NOW }], 11);
  assert.equal(conflict.conflicted, false);
});

// --- Gate (canonical control boundary) ---
test("gate rejects a stale plan outright", () => {
  const policy = new PolicyEngine({ rules: defaultRules() });
  const p = plan("increase_cache_capacity", 10);
  const d = evaluateGate({ plan: p, currentStateVersion: 12, permission: { granted: [], level: "L3" }, delegation: null, now: NOW }, policy);
  assert.equal(d.allowed, false);
  assert.equal(d.stage, "freshness");
});

test("gate allows low-risk reversible L4 plan without approval", () => {
  const policy = new PolicyEngine({ rules: defaultRules() });
  const p = plan("increase_cache_capacity", 10);
  const d = evaluateGate({ plan: p, currentStateVersion: 10, permission: { granted: [], level: "L4" }, delegation: null, now: NOW }, policy);
  assert.equal(d.allowed, true);
  assert.equal(d.approvalRequired, false);
});

test("gate requires approval for production config change", () => {
  const policy = new PolicyEngine({ rules: defaultRules() });
  const p = plan("change_configuration", 10);
  const d = evaluateGate({ plan: p, currentStateVersion: 10, permission: { granted: [], level: "L3" }, delegation: null, now: NOW }, policy);
  assert.equal(d.allowed, true);
  assert.equal(d.approvalRequired, true);
});

test("gate rejects a high-risk plan for an L2 agent", () => {
  const policy = new PolicyEngine({ rules: defaultRules() });
  const p = plan("rollback_deployment", 10);
  const d = evaluateGate({ plan: p, currentStateVersion: 10, permission: { granted: [], level: "L2" }, delegation: null, now: NOW }, policy);
  assert.equal(d.allowed, false);
  assert.ok(["permission", "authority"].includes(d.stage));
});

// --- Phase 14: Concurrency and Stale State ---

test("PHASE14: plan created at version 10, current state version 11 → plan must NOT execute (mandatory verification)", () => {
  const policy = new PolicyEngine({ rules: defaultRules() });
  const p = plan("increase_cache_capacity", 10);
  const d = evaluateGate({ plan: p, currentStateVersion: 11, permission: { granted: [], level: "L3" }, delegation: null, now: NOW }, policy);
  assert.equal(d.allowed, false, "stale plan must be rejected");
  assert.equal(d.stage, "freshness", "rejection must come from the freshness stage");
  assert.ok(d.detail.planVersion === 10, "detail must record plan version 10");
  assert.ok(d.detail.currentVersion === 11, "detail must record current version 11");
});

test("PHASE14: plan at version 10 is fresh when current is also 10", () => {
  const policy = new PolicyEngine({ rules: defaultRules() });
  const p = plan("increase_cache_capacity", 10);
  const d = evaluateGate({ plan: p, currentStateVersion: 10, permission: { granted: [], level: "L3" }, delegation: null, now: NOW }, policy);
  assert.equal(d.allowed, true, "fresh plan should pass gate");
  assert.notEqual(d.stage, "freshness", "should not fail at freshness stage");
});

test("PHASE14: concurrent human change on cache resource invalidates a cache plan", () => {
  const p = plan("increase_cache_capacity", 10);
  const mutations = [
    { resource: "cache", actor: "human", version: 11, timestamp: NOW },
  ];
  const conflict = detectConflicts(p, mutations, 11);
  assert.equal(conflict.conflicted, true, "must detect conflict on cache resource");
  assert.equal(conflict.conflicts[0].resource, "cache");
  assert.equal(conflict.conflicts[0].mutation.actor, "human");
});

test("PHASE14: concurrent human change on unrelated resource does NOT invalidate cache plan", () => {
  const p = plan("increase_cache_capacity", 10);
  const mutations = [
    { resource: "database", actor: "human", version: 11, timestamp: NOW },
  ];
  const conflict = detectConflicts(p, mutations, 11);
  assert.equal(conflict.conflicted, false, "unrelated mutation must not conflict");
});

test("PHASE14: gate rejects plan with both stale version AND concurrent conflict", () => {
  const policy = new PolicyEngine({ rules: defaultRules() });
  const p = plan("increase_cache_capacity", 10);
  const mutations = [{ resource: "cache", actor: "human", version: 11, timestamp: NOW }];
  const d = evaluateGate({
    plan: p,
    currentStateVersion: 11,
    mutationsSince: mutations,
    permission: { granted: [], level: "L3" },
    delegation: null,
    now: NOW,
  }, policy);
  assert.equal(d.allowed, false, "must be rejected");
  assert.equal(d.stage, "freshness", "freshness check fires before conflict check");
});

test("PHASE14: stale plan detection is version-monotonic (10→12 is also stale)", () => {
  const s10_v11 = validatePlanFreshness(10, 11);
  const s10_v12 = validatePlanFreshness(10, 12);
  const s10_v100 = validatePlanFreshness(10, 100);
  assert.equal(s10_v11.ok, false);
  assert.equal(s10_v12.ok, false);
  assert.equal(s10_v100.ok, false);
});

test("PHASE14: stale plan status includes planVersion and currentVersion for diagnostics", () => {
  const result = validatePlanFreshness(10, 11);
  assert.equal(result.ok, false);
  assert.equal(result.stale, true);
  assert.equal(result.planVersion, 10);
  assert.equal(result.currentVersion, 11);
  assert.ok(typeof result.reason === "string");
  assert.ok(result.reason.includes("STALE_PLAN"));
});
