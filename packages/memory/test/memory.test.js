import { test } from "node:test";
import assert from "node:assert/strict";
import { DecisionMemory } from "../dist/index.js";
import { fingerprintState, stateDistance } from "../dist/fingerprint.js";
import { ConsequenceMemory } from "../dist/consequence-memory.js";
import { PatternMemory } from "../dist/pattern-memory.js";
import { retrieveSimilar } from "../dist/retrieval.js";

test("fingerprint: deterministic and order-independent", () => {
  assert.equal(fingerprintState({ a: 1, b: 2 }), fingerprintState({ b: 2, a: 1 }));
  assert.notEqual(fingerprintState({ a: 1, b: 2 }), fingerprintState({ a: 1, b: 3 }));
});

test("fingerprint: distance identical = 0, disjoint = 1", () => {
  assert.equal(stateDistance({ a: 5 }, { a: 5 }), 0);
  assert.equal(stateDistance({ a: 1 }, { b: 2 }), 1);
});

test("consequence memory: records, filters by plan, counts", () => {
  const m = new ConsequenceMemory();
  const rec = m.record({
    planId: "p1",
    actionType: "restart_cache",
    prediction: { checkoutLatencyMs: 40 },
    actual: { checkoutLatencyMs: 60 },
    error: 20,
    outcomeKind: "DEVIATION",
    nextAction: "reinvestigate",
    cause: "under-modeled",
    lesson: "restart does not clear the backpressure source",
  });
  assert.match(rec.consequenceId, /^consequence_\d+$/);
  assert.equal(m.count(), 1);
  assert.equal(m.forPlan("p1").length, 1);
});

test("pattern memory: repeated consequence coalesces occurrences", () => {
  const pm = new PatternMemory();
  const base = {
    consequenceId: "x",
    planId: "p1",
    actionType: "restart_cache",
    prediction: {},
    actual: { checkoutLatencyMs: 60 },
    error: 0,
    outcomeKind: "DEVIATION",
    nextAction: "reinvestigate",
    cause: "c",
    lesson: "l",
    createdAt: 0,
  };
  pm.observe(base);
  const second = pm.observe(base);
  assert.equal(second.occurrences, 2);
  assert.equal(pm.recurring(2).length, 1);
  assert.equal(pm.recurring(3).length, 0);
});

test("retrieval: similar states rank highest", () => {
  const history = [
    {
      decisionId: "d1",
      stateFingerprint: "a:1|b:2",
      hypothesis: "h",
      planId: "p1",
      assumptions: [],
      prediction: {},
      actual: { a: 1, b: 2 },
      predictionError: 0,
      outcome: "PROCEED",
      humanOverride: false,
      lesson: "l",
      createdAt: 0,
    },
    {
      decisionId: "d2",
      stateFingerprint: "a:9|b:9",
      hypothesis: "h",
      planId: "p2",
      assumptions: [],
      prediction: {},
      actual: { a: 9, b: 9 },
      predictionError: 0,
      outcome: "PROCEED",
      humanOverride: false,
      lesson: "l",
      createdAt: 0,
    },
  ];
  const hits = retrieveSimilar(history, { a: 1, b: 2 }, 2).hits;
  assert.equal(hits[0].decisionId, "d1");
});

test("DecisionMemory facade: record + query + recurring patterns", () => {
  const mem = new DecisionMemory();
  mem.record({
    hypothesis: "cache degradation",
    planId: "p1",
    assumptions: [],
    prediction: { checkoutLatencyMs: 40 },
    actual: { checkoutLatencyMs: 60, cacheHitRateEstimate: 40 },
    predictionError: 20,
    outcome: "PROCEED",
    humanOverride: false,
    lesson: "scale cache capacity",
  });
  mem.recordConsequence({
    planId: "p1",
    actionType: "increase_cache_capacity",
    prediction: { checkoutLatencyMs: 40 },
    actual: { checkoutLatencyMs: 60, cacheHitRateEstimate: 40 },
    error: 20,
    outcomeKind: "DEVIATION",
    nextAction: "reinvestigate",
    cause: "c",
    lesson: "scale cache capacity",
  });
  assert.equal(mem.count(), 1);
  assert.equal(mem.consequencesAll().length, 1);
  const q = mem.query({ checkoutLatencyMs: 60, cacheHitRateEstimate: 40 });
  assert.equal(q.length, 1);
  assert.equal(q[0].planId, "p1");
  assert.ok(q[0].similarity > 0.9);
});
