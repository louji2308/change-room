import { test } from "node:test";
import assert from "node:assert/strict";

import {
  WorldSimulator,
  SeededRng,
  generateDisturbances,
  cacheDegradationDemo,
  createAction,
  applyAction,
  tick,
  computeTuningAt,
  defaultTuning,
  validateWorld,
  WorldState,
  TOPOLOGY,
} from "../dist/index.js";

function fresh(seed = 1) {
  return new WorldSimulator({ seed, scenario: "demo" });
}

function runIncident(sim, steps = 100) {
  const base = { ...sim.observe().kpis };
  sim.startIncident();
  for (let i = 0; i < steps; i++) sim.step(1);
  const inc = { ...sim.observe().kpis };
  return { base, inc };
}

test("homework primitive: same seed produces same RNG sequence", () => {
  const a = new SeededRng(42);
  const b = new SeededRng(42);
  const seqA = [a.next(), a.next(), a.next()];
  const seqB = [b.next(), b.next(), b.next()];
  assert.deepEqual(seqA, seqB);
  const c = new SeededRng(43);
  assert.notDeepEqual([c.next(), c.next()], [seqA[0], seqA[1]]);
});

// ---- Causal rule tests (Implementation.md Phase 2) ----

test("causal rule: cache degradation -> cache hit rate falls, DB pressure rises, checkout degrades", () => {
  const sim = fresh();
  const { base, inc } = runIncident(sim);
  assert.ok(
    base.checkoutLatencyMs < inc.checkoutLatencyMs,
    `checkout latency should rise (${base.checkoutLatencyMs} -> ${inc.checkoutLatencyMs})`
  );
  assert.ok(
    base.checkoutErrorRate < inc.checkoutErrorRate,
    `checkout error rate should rise (${base.checkoutErrorRate} -> ${inc.checkoutErrorRate})`
  );
  const cache = sim.observe().metrics.find((m) => m.componentId === "cache");
  const db = sim.observe().metrics.find((m) => m.componentId === "database");
  const checkout = sim.observe().metrics.find((m) => m.componentId === "checkout");
  assert.ok(cache.degraded === true, "cache should be degraded under incident");
  assert.ok(checkout.degraded === true, "checkout should be degraded under incident");
  assert.ok(
    cache.utilization > 90,
    `cache utilization should saturate under incident (got ${cache.utilization})`
  );
  assert.ok(
    db.utilization > 40,
    `DB pressure should rise under incident (got ${db.utilization})`
  );
});

test("causal rule: increasing traffic raises checkout load monotonically", () => {
  // Deterministic rule-level check independent of random seed.
  const world = new WorldState(TOPOLOGY.map((c) => c.id));
  const low = defaultTuning(1000);
  const high = defaultTuning(2500);
  tick(world, low, 1);
  tick(world, low, 1);
  const lowCheckout = world.get("checkout").latencyMs;
  const w2 = new WorldState(TOPOLOGY.map((c) => c.id));
  tick(w2, high, 1);
  tick(w2, high, 1);
  const highCheckout = w2.get("checkout").latencyMs;
  assert.ok(
    highCheckout >= lowCheckout,
    `higher traffic should not lower checkout latency (${lowCheckout} vs ${highCheckout})`
  );
});

test("causal rule: idle homogeneous worlds are equal (no hidden variance)", () => {
  const a = new WorldState(TOPOLOGY.map((c) => c.id));
  const b = new WorldState(TOPOLOGY.map((c) => c.id));
  tick(a, defaultTuning(1000), 1);
  tick(b, defaultTuning(1000), 1);
  assert.equal(a.fingerprint(), b.fingerprint());
  assert.equal(a.get("checkout").latencyMs, b.get("checkout").latencyMs);
});

// ---- Determinism tests ----

test("determinism: same seed + same action => identical prediction", () => {
  const action = createAction("increase_cache_capacity", { newCapacityGB: 30 });
  const sim1 = fresh(7);
  const sim2 = fresh(7);
  const r1 = { base1: sim1.observe(), inc1: runIncident(sim1), pred1: sim1.predict(action) };
  const r2 = { base2: sim2.observe(), inc2: runIncident(sim2), pred2: sim2.predict(action) };
  // Same seeds must reproduce identical baseline + incident KPIs and predictions.
  assert.equal(r1.base1.kpis.checkoutLatencyMs, r2.base2.kpis.checkoutLatencyMs);
  assert.equal(r1.inc1.inc.checkoutLatencyMs, r2.inc2.inc.checkoutLatencyMs);
  assert.equal(r1.pred1.kpis.checkoutLatencyMs, r2.pred2.kpis.checkoutLatencyMs);
  assert.equal(r1.pred1.fingerprint, r2.pred2.fingerprint);
});

test("determinism: disturbance generation is reproducible from seed", () => {
  const a = generateDisturbances(1234);
  const b = generateDisturbances(1234);
  assert.deepEqual(a, b);
  // Every generated disturbance has a valid type and a bounded magnitude.
  const validTypes = new Set([
    "traffic_spike",
    "cache_degradation",
    "database_contention",
    "dependency_latency",
    "deployment_memory",
    "queue_backlog",
    "configuration_regression",
  ]);
  for (const d of a) {
    assert.ok(validTypes.has(d.type), `unexpected type ${d.type}`);
    assert.ok(Number.isFinite(d.magnitude));
    assert.ok(d.start >= 0);
    assert.ok(d.ramp > 0);
  }
});

// ---- Isolation test (Prediction World) ----

test("isolation: predict() never mutates the execution world", () => {
  const sim = fresh();
  runIncident(sim);
  const before = sim.world.fingerprint();
  const beforeKpis = JSON.stringify(sim.observe().kpis);
  const action = createAction("increase_cache_capacity", { newCapacityGB: 30 });
  const pred = sim.predict(action);
  const after = sim.world.fingerprint();
  assert.equal(before, after, "execution world fingerprint must not change");
  assert.equal(JSON.stringify(sim.observe().kpis), beforeKpis);
  // The predicted world is a separate clone: its KPIs show recovery while the
  // execution world stays degraded.
  assert.ok(pred.kpis.checkoutErrorRate < sim.observe().kpis.checkoutErrorRate);
});

// ---- Regression test ----

test("regression: after simulation the real sandbox state is unchanged", () => {
  const sim = fresh();
  const baseline = sim.world.fingerprint();
  runIncident(sim);
  const incident = sim.world.fingerprint();
  assert.notEqual(incident, baseline, "incident should change the world");
  const action = createAction("scale_database", { factor: 1.5 });
  sim.predict(action); // branch only
  assert.equal(sim.world.fingerprint(), incident, "execution world unchanged by prediction");
});

// ---- Remediation / action effects ----

test("remediation action predicts recovery from cache degradation", () => {
  const sim = fresh();
  const { inc } = runIncident(sim);
  assert.ok(inc.checkoutErrorRate > 5, "sanity: incident caused degradation");
  const action = createAction("increase_cache_capacity", { newCapacityGB: 30 });
  const pred = sim.predict(action);
  assert.equal(pred.ok, true);
  assert.ok(
    pred.kpis.checkoutErrorRate < inc.checkoutErrorRate,
    "remediation should reduce checkout error rate"
  );
  assert.ok(
    pred.kpis.checkoutLatencyMs < inc.checkoutLatencyMs,
    "remediation should reduce checkout latency"
  );
});

test("invalid action is rejected without mutating anything", () => {
  const sim = fresh();
  runIncident(sim);
  const before = sim.world.fingerprint();
  // negative capacity precondition must fail
  const bad = createAction("increase_cache_capacity", { newCapacityGB: -5 });
  const pred = sim.predict(bad);
  assert.equal(pred.ok, false);
  assert.ok(pred.unmet.length > 0);
  assert.equal(sim.world.fingerprint(), before);
});

test("do_nothing action leaves world equivalent (no unintended change)", () => {
  const sim = fresh();
  runIncident(sim);
  const action = createAction("do_nothing");
  const pred = sim.predict(action);
  assert.equal(pred.ok, true);
  // do_nothing should predict continued degradation, not recovery.
  assert.ok(
    pred.kpis.checkoutErrorRate >= sim.observe().kpis.checkoutErrorRate
  );
});

// ---- Constraints ----

test("constraint engine: world stays plausible through an incident", () => {
  const sim = fresh();
  runIncident(sim);
  const { ok, violations } = sim.validate();
  assert.equal(ok, true, `world must satisfy constraints: ${JSON.stringify(violations)}`);
  for (const m of sim.observe().metrics) {
    assert.ok(m.utilization >= 0 && m.utilization <= 100);
    assert.ok(m.errorRate >= 0 && m.errorRate <= 100);
    assert.ok(m.latencyMs >= 0);
  }
});

test("constraint: traffic cannot be negative", () => {
  const world = new WorldState(TOPOLOGY.map((c) => c.id));
  assert.throws(() => tick(world, defaultTuning(-5), 1), /negative/);
});

// ---- Tunings ----

test("computeTuningAt ramps a disturbance in over time", () => {
  const base = defaultTuning(1200);
  const d = cacheDegradationDemo(1);
  const atStart = computeTuningAt(base, d, 0);
  assert.equal(atStart.capacityMultiplier.cache, undefined, "no effect before ramp");
  const late = computeTuningAt(base, d, 1000);
  assert.ok(
    (late.capacityMultiplier.cache ?? 1) < 0.7,
    "cache multiplier should be degraded at full strength"
  );
});

test("applyAction validates preconditions", () => {
  const tuning = defaultTuning(1200);
  const ok = createAction("scale_service", { service: "checkout", factor: 1.5 });
  const res = applyAction(tuning, ok);
  assert.equal(res.ok, true);
  assert.ok(res.tuning.capacityMultiplier.checkout === 1.5);
  // Cannot scale traffic directly.
  const bad = createAction("scale_service", { service: "traffic" });
  const resBad = applyAction(tuning, bad);
  assert.equal(resBad.ok, false);
});

test("validateWorld flags impossible utilization", () => {
  const world = new WorldState(["checkout"]);
  world.get("checkout").utilization = 150;
  const v = validateWorld(world);
  assert.ok(v.some((x) => x.componentId === "checkout"));
});

test("full seeded run is reproducible in outcome", () => {
  const a = (() => { const s = new WorldSimulator({ seed: 555, scenario: "demo" }); runIncident(s); return s.observe().kpis; })();
  const b = (() => { const s = new WorldSimulator({ seed: 555, scenario: "demo" }); runIncident(s); return s.observe().kpis; })();
  assert.deepEqual(a, b);
});

test("determinism under repetition: same seed + same action yields identical results across 20 runs", () => {
  const seed = 42;
  const action = createAction("increase_cache_capacity", { newCapacityGB: 30 });
  const results = [];
  for (let i = 0; i < 20; i++) {
    const sim = new WorldSimulator({ seed, scenario: "demo" });
    sim.runBaseline(60);
    sim.startIncident();
    for (let s = 0; s < 60; s++) sim.step(1);
    const pred = sim.predict(action);
    results.push({
      ok: pred.ok,
      fingerprint: pred.fingerprint,
      checkoutLatencyMs: pred.kpis.checkoutLatencyMs,
      checkoutErrorRate: pred.kpis.checkoutErrorRate,
    });
  }
  for (let i = 1; i < results.length; i++) {
    assert.deepEqual(results[i], results[0], `run ${i} must match run 0`);
  }
});

test("simulator events do not leak across fresh instances (bounded per instance)", () => {
  const sim1 = new WorldSimulator({ seed: 1, scenario: "demo" });
  sim1.runBaseline(60);
  sim1.startIncident();
  for (let i = 0; i < 100; i++) sim1.step(1);
  const count1 = sim1.observe().events.length;
  assert.ok(count1 > 0, "first simulator produced events");

  const sim2 = new WorldSimulator({ seed: 1, scenario: "demo" });
  const count2 = sim2.observe().events.length;
  assert.equal(count2, 0, "fresh simulator has no events yet");
});
