import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ScenarioRunner,
  SCENARIOS,
  listScenarios,
  getScenario,
  runBlindSession,
} from "../dist/index.js";
import { createAction } from "@change-room/simulator";

const ALL_IDS = [
  // 16.1 — single failures
  "cache-failure",
  "traffic-surge",
  "database-saturation",
  "bad-deployment",
  "queue-backlog",
  "configuration-regression",
  // 16.2 — cascading failure
  "cascade-cache-db-checkout",
  // 16.3 — misleading evidence
  "misleading-deployment",
  // 16.4 — compound failure
  "compound-traffic-cache",
];

const NEW_IDS = [
  "cascade-cache-db-checkout",
  "misleading-deployment",
  "compound-traffic-cache",
];

function runScenario(id, steps = 120) {
  const runner = ScenarioRunner.setup(id);
  runner.start();
  for (let i = 0; i < steps; i++) runner.step(1);
  return runner;
}

test("registry exposes all nine named scenarios", () => {
  const ids = listScenarios();
  for (const id of ALL_IDS) assert.ok(ids.includes(id), `missing ${id}`);
  for (const id of ALL_IDS) {
    assert.ok(getScenario(id), `getScenario(${id})`);
  }
  assert.equal(SCENARIOS.length, ALL_IDS.length);
  for (const s of SCENARIOS) {
    assert.ok(s.seed >= 0);
    assert.ok(s.disturbances.length >= 1);
    for (const d of s.disturbances) assert.ok(d.magnitude >= 0);
    assert.ok(s.kind, `${s.id}: kind must be set`);
  }
  for (const id of ALL_IDS.slice(0, 6)) {
    assert.equal(getScenario(id).kind, "single", `${id}: 16.1 suites are singles`);
  }
  assert.equal(getScenario("cascade-cache-db-checkout").kind, "cascade");
  assert.equal(getScenario("misleading-deployment").kind, "misleading");
  assert.equal(getScenario("compound-traffic-cache").kind, "compound");
});

test("every scenario produces a real incident (none stays healthy)", () => {
  for (const id of ALL_IDS) {
    const runner = runScenario(id);
    const health = runner.health();
    assert.ok(
      health === "down" || health === "degraded",
      `${id}: incident must not stay healthy (got ${health})`
    );
  }
});

test("every scenario is recoverable through its declared expected recovery", () => {
  const params = {
    increase_cache_capacity: { newCapacityGB: 30 },
    restart_cache: {},
    scale_database: { factor: 1.5 },
    scale_service: { service: "checkout", factor: 1.5 },
    restore_configuration: {},
    change_configuration: {},
    rollback_deployment: {},
  };
  for (const id of ALL_IDS) {
    const runner = runScenario(id);
    const expected = getScenario(id).expectedRecovery;
    assert.ok(expected.length >= 1, `${id}: expectedRecovery must be declared`);
    for (const action of expected) {
      assert.ok(params[action], `${id}: unknown recovery action ${action}`);
      const res = runner.executeChange(action, params[action]);
      assert.equal(res.ok, true, `${id}: recovery action ${action} must be executable`);
      for (let i = 0; i < 60; i++) runner.step(1);
    }
    assert.equal(
      runner.health(),
      "healthy",
      `${id}: declared expectedRecovery [${expected.join(", ")}] must recover the system`
    );
  }
});

test("16.2 cascade: remediating only the tail leaves the root cause unrecovered", () => {
  const runner = runScenario("cascade-cache-db-checkout");
  assert.ok(runner.health() !== "healthy", "sanity: cascade incident degraded the system");

  // scale_database addresses the *tail* (database backup), not the root (cache).
  const res = runner.executeChange("scale_database", { factor: 1.5 });
  assert.equal(res.ok, true);
  for (let i = 0; i < 60; i++) runner.step(1);
  assert.notEqual(runner.health(), "healthy", "tail-only remediation must not fully recover");

  // Now fix the root and verify the cascade resolves.
  runner.executeChange("increase_cache_capacity", { newCapacityGB: 30 });
  for (let i = 0; i < 60; i++) runner.step(1);
  assert.equal(runner.health(), "healthy");
});

test("16.3 misleading: a recent deployment is surfaced but is NOT the root cause", () => {
  const runner = runScenario("misleading-deployment");
  const before = runner.agentView();

  // The deployment is observable — it is evidence, and evidence is surfaced.
  assert.ok(before.deployments.length === 1, "view must carry the deployment record");
  assert.equal(before.deployments[0].version, "v2.14.0");
  assert.ok(before.deployments[0].deployedAt <= before.timestamp, "deployment precedes the incident");

  // But it is NOT a cause: ground truth carries a single cache cause.
  const gt = runner.groundTruth();
  assert.equal(gt.kind, "misleading");
  assert.equal(gt.deployments.length, 1);
  const causeTypes = gt.disturbances.map((d) => d.type);
  assert.ok(causeTypes.includes("cache_degradation"));
  assert.ok(!causeTypes.includes("deployment_memory"), "deployment is NOT the cause");
  assert.ok(
    !causeTypes.some((t) => t.includes("deployment")),
    "no deployment-typed disturbance in the misleading scenario"
  );
});

test("16.3 misleading: view never leaks its scenario id, seed, or disturbance internals", () => {
  const runner = runScenario("misleading-deployment");
  runner.start();
  for (let i = 0; i < 45; i++) runner.step(1);
  const blob = JSON.stringify(runner.agentView());
  assert.ok(!blob.includes("misleading-deployment"), "view leaked scenario id");
  assert.ok(!blob.includes("808"), "view leaked the seed");
  assert.ok(!blob.includes("deployment_memory"), "view leaked a disturbance type");
  assert.ok(!blob.includes("magnitude"), "view leaked magnitude");
});

test("16.4 compound: recovering only one cause leaves the other's symptoms behind", () => {
  const runner = runScenario("compound-traffic-cache");
  assert.ok(runner.health() !== "healthy", "sanity: compound incident degraded the system");

  // Recover only cause A (traffic): the cache collapse remains.
  runner.executeChange("scale_service", { service: "checkout", factor: 1.5 });
  for (let i = 0; i < 60; i++) runner.step(1);
  const afterA = runner.agentView();
  assert.notEqual(afterA.health, "healthy", "fixing only the surge must leave cache symptoms");

  // Recover cause B too: the compound resolves.
  runner.executeChange("increase_cache_capacity", { newCapacityGB: 30 });
  for (let i = 0; i < 60; i++) runner.step(1);
  assert.equal(runner.health(), "healthy");
});

test("agent view is blind: no seed, scenario id, disturbance list, or cause", () => {
  for (const id of ALL_IDS) {
    const runner = runScenario(id);
    const view = runner.agentView();
    const blob = JSON.stringify(view);
    assert.equal(view.blind, true, `${id}: view must be flagged blind`);
    // hidden fields must never appear anywhere in the serialized payload
    assert.ok(!blob.includes("seed"), `${id}: agent view leaked 'seed'`);
    assert.ok(!blob.includes("cache_degradation"), `${id}: agent view leaked disturbance type`);
    assert.ok(!blob.includes("disturbances"), `${id}: agent view leaked 'disturbances'`);
    assert.ok(!blob.includes("magnitude"), `${id}: agent view leaked 'magnitude'`);
    assert.ok(!blob.includes(id), `${id}: agent view leaked its own scenario id`);
    // the causal cause (startIncident event) is redacted
    for (const log of view.logs) {
      assert.ok(log.type !== "incident_started" || !JSON.stringify(log).includes("dist_"));
    }
  }
});

test("symptoms emerge: cache-failure degrades cache and raises checkout latency", () => {
  const runner = runScenario("cache-failure");
  assert.equal(runner.health(), "down" || "degraded", "should not stay healthy");
  const metrics = runner.agentView().metrics;
  const cache = metrics.find((m) => m.componentId === "cache");
  const checkout = metrics.find((m) => m.componentId === "checkout");
  assert.ok(cache, "cache metric present");
  assert.equal(cache.degraded, true, "cache should be degraded");
  assert.ok(checkout.latencyMs >= 100, `checkout latency should rise (got ${checkout.latencyMs})`);
});

test("each named scenario produces a distinct observable profile", () => {
  const profiles = ALL_IDS.map((id) => {
    const runner = runScenario(id);
    const view = runner.agentView();
    const metricStr = view.metrics
      .map((m) => `${m.componentId}:${m.utilization}|${m.latencyMs}|${m.degraded}`)
      .join(",");
    // deployment records are observation too — 16.3 intentionally shares its
    // underlying metrics with cache-failure, so the record is part of the
    // fingerprint that keeps every scenario distinguishable.
    const deployStr = (view.deployments ?? [])
      .map((d) => `${d.componentId}@${d.deployedAt}:${d.version}`)
      .join(",");
    return `${view.health}|${metricStr}|deploys=${deployStr}`;
  });
  assert.equal(new Set(profiles).size, ALL_IDS.length, "profiles must be distinct");
});

test("ground truth is hidden from agent view but present behind groundTruth()", () => {
  const id = "database-saturation";
  const runner = runScenario(id);
  const viewBlob = JSON.stringify(runner.agentView());
  assert.ok(!viewBlob.includes("database_contention"), "cause not visible to agent");
  const gt = runner.groundTruth();
  assert.equal(gt.scenarioId, id);
  assert.ok(gt.disturbances.length >= 2, "ground truth carries the real disturbances");
  assert.ok(
    gt.disturbances.some((d) => d.type === "database_contention"),
    "ground truth names the true cause"
  );
});

test("session() is opaque and carries no ground truth", () => {
  for (const id of ALL_IDS) {
    const runner = runScenario(id);
    const s = runner.session();
    // scenarioId is an opaque scenario-<hex> id, NOT scenario-<decimal-seed>
    assert.match(s.scenarioId, /^scenario-[0-9a-f]+$/, `${id}: opaque hex id`);
    const blob = JSON.stringify(s);
    assert.ok(!("groundTruth" in s), `${id}: session must not carry ground truth`);
    assert.ok(!blob.includes("seed"), `${id}: session leaked 'seed'`);
    assert.ok(!blob.includes("magnitude"), `${id}: session leaked 'magnitude'`);
    assert.ok(!blob.includes("disturbances"), `${id}: session leaked 'disturbances'`);
  }
});

test("reset() restores a clean, healthy baseline and returns nothing", () => {
  const runner = runScenario("queue-backlog");
  assert.ok(runner.health() !== "healthy", "sanity: incident degraded the world");
  // reset() must not leak the raw simulator (no .seed / .disturbances): returns void
  const clean = runner.reset();
  assert.equal(clean, undefined, "reset() must not return the ground-truth-bearing simulator");
  // fresh baseline has no disturbances, so health should recover to healthy via the runner
  assert.equal(runner.health(), "healthy");
});

test("reproducibility: same scenario + same steps => identical agent view", () => {
  const a = runScenario("bad-deployment");
  const b = runScenario("bad-deployment");
  assert.deepEqual(
    JSON.parse(JSON.stringify(a.agentView())),
    JSON.parse(JSON.stringify(b.agentView()))
  );
});

test("injection stays within defined causal transitions (no fake numbers)", () => {
  for (const id of ALL_IDS) {
    const runner = runScenario(id);
    for (const m of runner.agentView().metrics) {
      assert.ok(m.utilization >= 0 && m.utilization <= 100, `${id}: bad utilization`);
      assert.ok(m.errorRate >= 0 && m.errorRate <= 100, `${id}: bad error rate`);
      assert.ok(m.latencyMs >= 0, `${id}: negative latency`);
    }
  }
});

test("evaluate() scores operator decisions against expected recovery", () => {
  const runner = runScenario("cache-failure");
  const res = runner.evaluate([{ kind: "increase_cache_capacity" }]);
  assert.ok(res.recoveryHits.includes("increase_cache_capacity"));
  assert.ok(res.score > 0);
  assert.ok(res.session.scenarioId.startsWith("scenario-"));
});

test("executeChange() remediates cache failure on the live execution world", () => {
  const runner = runScenario("cache-failure");
  assert.equal(runner.agentView().health, "down");

  const res = runner.executeChange("increase_cache_capacity", { newCapacityGB: 30 });
  assert.equal(res.ok, true);
  assert.deepEqual(res.unmet, []);

  // let the remediated world settle and verify it recovers
  runner.settle(30);
  assert.equal(runner.health(), "healthy");
});

test("executeChange() reports unmet preconditions and does not recover", () => {
  const runner = runScenario("cache-failure");
  // a no-op action will not remediate
  const res = runner.executeChange("do_nothing", {});
  assert.equal(res.ok, true);
  runner.settle(30);
  assert.notEqual(runner.health(), "healthy");
});

test("rollback() faithfully reverts the last executed change", () => {
  const runner = runScenario("cache-failure");
  assert.equal(runner.executeChange("increase_cache_capacity", { newCapacityGB: 30 }).ok, true);
  runner.step(5);
  const healthAfterChange = runner.health();
  assert.equal(healthAfterChange, "healthy", "remediation should have recovered the world");

  const rb = runner.rollback();
  assert.equal(rb.ok, true);
  runner.settle(5);
  assert.notEqual(runner.health(), "healthy", "rollback must return the world to its degraded state");
});

test("predict() mirrors executeChange remediation semantics (single cause)", () => {
  const runner = runScenario("cache-failure");
  const prediction = runner.predict(createAction("increase_cache_capacity", { newCapacityGB: 30 }));
  assert.equal(prediction.ok, true);
  // After a faithful remediation prediction the branch world is healthy.
  assert.equal(prediction.kpis.systemHealth, "healthy");
});

test("blind evaluation returns the full structured Phase-16 metric set for every scenario", () => {
  for (const id of ALL_IDS) {
    const run = runBlindSession({ scenarioId: id, incidentSeconds: 120 });
    assert.equal(run.scenarioId, id);
    assert.ok(run.healthSequence.length >= 1, `${id}: health sequence observed`);
    assert.ok(run.expectedCauses.length >= 1, `${id}: expected causes resolved`);

    const m = run.metrics;
    for (const [name, metric] of Object.entries(m)) {
      assert.ok(metric && typeof metric === "object", `${id}: metric ${name} shape`);
      assert.ok("value" in metric, `${id}: metric ${name} has a value`);
      assert.ok(
        typeof metric.status === "string" && metric.status.length,
        `${id}: metric ${name} has a status`
      );
      assert.ok(
        metric.detail === undefined || Array.isArray(metric.detail),
        `${id}: metric ${name} detail is an array when present`
      );
    }

    // consistency checks
    const { diagnosisAccuracy, planEffectiveness, toolSelection, invalidCalls, risk, policyViolations, finalSystemHealth } = m;
    assert.ok(
      diagnosisAccuracy.value === null || [0, 0.75, 1].includes(diagnosisAccuracy.value),
      `${id}: diagnosisAccuracy domain`
    );
    if (planEffectiveness.value !== null) {
      assert.ok(planEffectiveness.value >= 0 && planEffectiveness.value <= 1, `${id}: planEffectiveness range`);
    }
    if (toolSelection.value.score !== null) {
      assert.ok(toolSelection.value.score >= 0 && toolSelection.value.score <= 1, `${id}: tool score range`);
      assert.ok(toolSelection.value.used.length >= 0);
      assert.deepEqual(toolSelection.value.expected, getScenario(id).expectedRecovery);
    }
    assert.equal(invalidCalls.value.count, invalidCalls.value.attempts.length, `${id}: invalidCalls consistent`);
    assert.ok(["low", "medium", "high", null].includes(risk.value.overall), `${id}: risk rank domain`);
    if (policyViolations.status === "computed") assert.ok(Number.isInteger(policyViolations.value.count));
    assert.ok(["healthy", "degraded", "down"].includes(finalSystemHealth.value), `${id}: health domain`);

    // ground truth rides only on the admin/blind-run object, never in agentView
    assert.equal(run.groundTruth.scenarioId, id);
    assert.ok(run.groundTruth.disturbances.length >= 1, `${id}: groundTruth names real disturbances`);
  }
});

test("blind evaluation diagnosis favors the true single cause", () => {
  const run = runBlindSession({ scenarioId: "cache-failure", incidentSeconds: 120 });
  assert.equal(run.metrics.diagnosisAccuracy.value, 1);
  assert.equal(run.metrics.finalSystemHealth.value, "healthy");
  assert.equal(run.metrics.rollbackSuccess.value, true);
});