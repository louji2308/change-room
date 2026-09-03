import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createPlan,
  createDecisionConfidence,
} from "../dist/index.js";

test("WorldRevision shape", () => {
  const r = { revision: 1, timestamp: 1000, parentRevision: null };
  assert.equal(r.revision, 1);
  assert.equal(r.parentRevision, null);
  assert.equal(typeof r.timestamp, "number");
});

test("WorldSnapshot shape", () => {
  const s = {
    id: "snap_1",
    revision: 1,
    world: { cache: 100 },
    capturedAt: 2000,
    fingerprint: "abc",
  };
  assert.equal(s.id, "snap_1");
  assert.equal(s.world.cache, 100);
  assert.equal(typeof s.fingerprint, "string");
  assert.equal(typeof s.capturedAt, "number");
});

test("WorldBranch shape carries all required fields", () => {
  const snap = {
    id: "s0",
    revision: 0,
    world: {},
    capturedAt: 0,
    fingerprint: "f0",
  };
  const b = {
    id: "br_1",
    parentWorldRevision: 0,
    originatingPlanId: "plan_1",
    actions: ["increase_cache"],
    initialState: snap,
    finalState: snap,
    metrics: { latency: 50 },
    health: "healthy",
    businessImpact: 0.1,
    risk: "low",
    simulationDuration: 100,
    assumptions: ["cache is warm"],
    outcome: "predicted",
  };
  assert.equal(b.id, "br_1");
  assert.equal(b.actions.length, 1);
  assert.equal(b.outcome, "predicted");
  assert.equal(b.health, "healthy");
  assert.equal(b.risk, "low");
  assert.equal(typeof b.businessImpact, "number");
  assert.equal(typeof b.simulationDuration, "number");
  assert.ok(Array.isArray(b.assumptions));
});

test("createDecisionConfidence defaults missing dimensions to 0.5", () => {
  const c = createDecisionConfidence({ diagnosis: 0.9 });
  assert.equal(c.diagnosis, 0.9);
  assert.equal(c.evidence, 0.5);
  assert.equal(c.action, 0.5);
  assert.equal(c.prediction, 0.5);
  assert.equal(c.policy, 0.5);
  assert.equal(c.stateFreshness, 0.5);
  assert.equal(c.robustness, 0.5);
});

test("createDecisionConfidence clamps values to [0,1]", () => {
  const c = createDecisionConfidence({ diagnosis: 2, evidence: -1 });
  assert.equal(c.diagnosis, 1);
  assert.equal(c.evidence, 0);
});

test("createDecisionConfidence requires diagnosis", () => {
  assert.throws(
    () => createDecisionConfidence({ evidence: 0.8 }),
    /diagnosis/,
  );
});

test("AgentDecision type union has 4 values", () => {
  const types = ["PROCEED", "ASK_HUMAN", "COLLECT_EVIDENCE", "ABSTAIN"];
  assert.equal(types.length, 4);

  const d = {
    type: "PROCEED",
    worldRevision: 1,
    confidence: createDecisionConfidence({ diagnosis: 0.8 }),
    reason: "all clear",
    requiredAuthority: "L1",
    missing: [],
  };
  assert.equal(d.type, "PROCEED");
  assert.ok(d.missing.length === 0);
  assert.equal(typeof d.worldRevision, "number");
  assert.equal(typeof d.reason, "string");
  assert.equal(d.requiredAuthority, "L1");
});

test("plan carries V2 lifecycle fields without breaking old required fields", () => {
  const p = createPlan({
    name: "Test plan",
    objective: "test objective",
    actions: [{ type: "noop", description: "no-op" }],
    stateVersion: 1,
    sourceWorldRevision: 42,
    candidateFutures: [{ branchId: "br_1", predictedActionSequence: ["a", "b"] }],
    robustness: {
      challengedWorlds: 5,
      successful: 3,
      partialFailures: 1,
      failures: 1,
      confidence: 0.6,
      boundaries: ["cache full"],
    },
    predictedMetrics: { latency: 45 },
    actualOutcome: { directedTo: "verify", predictionError: 0.12 },
    decisionConfidence: createDecisionConfidence({ diagnosis: 0.9, evidence: 0.7 }),
  });

  assert.equal(p.stateVersion, 1);
  assert.equal(p.sourceWorldRevision, 42);
  assert.equal(p.candidateFutures.length, 1);
  assert.equal(p.candidateFutures[0].branchId, "br_1");
  assert.deepEqual(p.candidateFutures[0].predictedActionSequence, ["a", "b"]);
  assert.equal(p.robustness.challengedWorlds, 5);
  assert.equal(p.robustness.successful, 3);
  assert.equal(p.robustness.partialFailures, 1);
  assert.equal(p.robustness.failures, 1);
  assert.equal(p.robustness.confidence, 0.6);
  assert.deepEqual(p.robustness.boundaries, ["cache full"]);
  assert.equal(p.predictedMetrics.latency, 45);
  assert.equal(p.actualOutcome.directedTo, "verify");
  assert.equal(p.actualOutcome.predictionError, 0.12);
  assert.equal(p.decisionConfidence.diagnosis, 0.9);
  assert.equal(p.decisionConfidence.evidence, 0.7);
  assert.equal(p.status, "DRAFT");
});

test("plan works without V2 fields (backwards compat)", () => {
  const p = createPlan({
    name: "Legacy plan",
    objective: "legacy",
    actions: [{ type: "noop", description: "no-op" }],
    stateVersion: 1,
  });
  assert.equal(p.sourceWorldRevision, undefined);
  assert.equal(p.candidateFutures, undefined);
  assert.equal(p.robustness, undefined);
  assert.equal(p.predictedMetrics, undefined);
  assert.equal(p.actualOutcome, undefined);
  assert.equal(p.decisionConfidence, undefined);
  assert.equal(p.status, "DRAFT");
  assert.equal(p.name, "Legacy plan");
});
