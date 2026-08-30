import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ScenarioRunner,
  SCENARIOS,
  listScenarios,
  getScenario,
} from "../dist/index.js";

const ALL_IDS = [
  "cache-failure",
  "traffic-surge",
  "database-saturation",
  "bad-deployment",
  "queue-backlog",
  "configuration-regression",
];

function runScenario(id, steps = 120) {
  const runner = ScenarioRunner.setup(id);
  runner.start();
  for (let i = 0; i < steps; i++) runner.step(1);
  return runner;
}

test("registry exposes all six required named scenarios", () => {
  const ids = listScenarios();
  for (const id of ALL_IDS) assert.ok(ids.includes(id), `missing ${id}`);
  for (const id of ALL_IDS) {
    assert.ok(getScenario(id), `getScenario(${id})`);
  }
  assert.equal(SCENARIOS.length, ALL_IDS.length);
  // every scenario is deterministic in its seed + disturbance set
  for (const s of SCENARIOS) {
    assert.ok(s.seed >= 0);
    assert.ok(s.disturbances.length >= 1);
    for (const d of s.disturbances) assert.ok(d.magnitude >= 0);
  }
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
    return `${view.health}|${metricStr}`;
  });
  // Every scenario's symptom fingerprint differs, so the agent can distinguish
  // problems by observation alone — without any ground-truth leak.
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
    assert.ok(!`scenario-${getSeed(id)}` === s.scenarioId || !JSON.stringify(s).includes(`${getSeed(id)}`), `${id}: session must not encode the seed`);
    const blob = JSON.stringify(s);
    assert.ok(!("groundTruth" in s), `${id}: session must not carry ground truth`);
    assert.ok(!blob.includes("seed"), `${id}: session leaked 'seed'`);
    assert.ok(!blob.includes("magnitude"), `${id}: session leaked 'magnitude'`);
    assert.ok(!blob.includes("disturbances"), `${id}: session leaked 'disturbances'`);
  }
});

function getSeed(id) {
  return SCENARIOS.find((s) => s.id === id).seed;
}

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

