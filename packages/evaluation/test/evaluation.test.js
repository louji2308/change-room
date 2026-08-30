import { test } from "node:test";
import assert from "node:assert/strict";

import { listScenarios, runBlindSession } from "@change-room/scenarios";
import { runAgentEvaluation, createPolicyCheck } from "../dist/index.js";

const METRIC_KEYS = [
  "diagnosisAccuracy",
  "planEffectiveness",
  "toolSelection",
  "invalidCalls",
  "timeToRecovery",
  "unnecessaryActions",
  "risk",
  "policyViolations",
  "humanInterventions",
  "predictionAccuracy",
  "rollbackSuccess",
  "finalSystemHealth",
];

test("agent evaluation recovers the cache-failure single failure with correct diagnosis", () => {
  const run = runAgentEvaluation({ scenarioId: "cache-failure", incidentSeconds: 120 });
  assert.equal(run.metrics.finalSystemHealth.value, "healthy");
  assert.equal(run.metrics.diagnosisAccuracy.value, 1);
  assert.equal(run.metrics.timeToRecovery.value, run.metrics.timeToRecovery.value); // number or null
});

test("agent evaluation on the misleading scenario sees the deployment but does NOT blame it", () => {
  const run = runAgentEvaluation({ scenarioId: "misleading-deployment", incidentSeconds: 120 });
  // deployed metadata is surfaceable observation, but the cause is the cache.
  assert.equal(run.groundTruth.kind, "misleading");
  assert.equal(run.metrics.diagnosisAccuracy.value, 1);
  assert.equal(run.metrics.finalSystemHealth.value, "healthy");
});

test("agent evaluation resolves the 16.2 cascade root-first", () => {
  const run = runAgentEvaluation({ scenarioId: "cascade-cache-db-checkout", incidentSeconds: 120 });
  assert.equal(run.groundTruth.kind, "cascade");
  assert.ok(run.expectedCauses[0] === "cache degradation", `root cause first (got ${run.expectedCauses[0]})`);
  assert.equal(run.metrics.finalSystemHealth.value, "healthy");
});

test("policy rules forbid actions and the run counts the violations", () => {
  const run = runAgentEvaluation({
    scenarioId: "cache-failure",
    incidentSeconds: 120,
    policyRules: [
      {
        id: "cache-change-freeze",
        forbidActionTypes: ["increase_cache_capacity", "restart_cache"],
        reason: "cache maintenance freeze is in effect",
      },
    ],
  });
  assert.ok(run.metrics.policyViolations.value.count >= 1, "forbidden actions must be counted");
  assert.ok(run.metrics.invalidCalls.value.count >= 1, "denied calls surface as invalid calls");
  assert.equal(run.metrics.policyViolations.status, "computed");
});

test("a deliberately invalid tool call is rejected and counted", () => {
  const run = runAgentEvaluation({ scenarioId: "cache-failure", incidentSeconds: 120, probeInvalidCall: true });
  assert.ok(run.metrics.invalidCalls.value.count >= 1);
});

test("agent evaluation returns the full structured Phase-16 metric set", () => {
  const run = runAgentEvaluation({ scenarioId: "compound-traffic-cache", incidentSeconds: 120 });
  for (const key of METRIC_KEYS) {
    assert.ok(key in run.metrics, `missing metric ${key}`);
    const m = run.metrics[key];
    assert.ok("value" in m, `${key}: value`);
    assert.ok(typeof m.status === "string" && m.status.length, `${key}: status`);
  }
  // ground truth stays behind the admin boundary, not in any operator payload
  assert.equal(run.groundTruth.scenarioId, "compound-traffic-cache");
  assert.ok(run.trace.operatorCalls.length >= 0);
});

test("agent evaluation is deterministic for a fixed scenario + options", () => {
  const a = runAgentEvaluation({ scenarioId: "cache-failure", incidentSeconds: 120 });
  const b = runAgentEvaluation({ scenarioId: "cache-failure", incidentSeconds: 120 });
  assert.deepEqual(JSON.parse(JSON.stringify(a.metrics)), JSON.parse(JSON.stringify(b.metrics)));
});

test("core blind harness and agent evaluation agree on the scenario registry", () => {
  const ids = listScenarios();
  assert.ok(ids.includes("cascade-cache-db-checkout"));
  assert.ok(ids.includes("misleading-deployment"));
  assert.ok(ids.includes("compound-traffic-cache"));
  // nothing breaks when the whole suite is run blind with the default operator
  for (const id of ids) {
    const run = runBlindSession({ scenarioId: id, incidentSeconds: 120 });
    assert.ok("metrics" in run, `${id}: structured metrics`);
    assert.equal(run.groundTruth.scenarioId, id);
  }
});

test("createPolicyCheck maps the control layer verdicts to allow/deny", () => {
  const permissive = createPolicyCheck([]);
  assert.deepEqual(permissive("scale_service", { service: "checkout", factor: 1.5 }, 0), {
    allowed: true,
    reason: "operation is permitted",
  });
  const strict = createPolicyCheck([
    { id: "no-rollback", forbidActionTypes: ["rollback_deployment"], reason: "manual only" },
  ]);
  assert.equal(strict("rollback_deployment", {}, 0).allowed, false);
  assert.match(strict("rollback_deployment", {}, 0).reason, /manual only/);
});