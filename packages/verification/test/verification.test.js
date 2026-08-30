import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyDeviation, metricsOf, PredictionVsReality } from "../dist/index.js";
import { createPlan } from "@change-room/domain";

// --- classifyDeviation ---
test("classifyDeviation returns HEALTHY when prediction equals actual", () => {
  const res = classifyDeviation({
    predicted: { checkoutLatencyMs: 220, checkoutSuccessRate: 99, ordersThroughputPerSec: 8 },
    actual: { checkoutLatencyMs: 220, checkoutSuccessRate: 99, ordersThroughputPerSec: 8 },
  });
  assert.equal(res.verdict, "HEALTHY");
  assert.equal(res.deviations.length, 3);
  assert.equal(res.deviations[0].delta, 0);
});

test("classifyDeviation is HEALTHY when differences are within threshold", () => {
  const res = classifyDeviation({
    predicted: { checkoutLatencyMs: 220, cacheHitRateEstimate: 92 },
    actual: { checkoutLatencyMs: 235, cacheHitRateEstimate: 94 },
  });
  assert.equal(res.verdict, "HEALTHY");
});

test("classifyDeviation is REGRESSION when actual latency is much higher", () => {
  const res = classifyDeviation({
    predicted: { checkoutLatencyMs: 220, checkoutErrorRate: 2 },
    actual: { checkoutLatencyMs: 480, checkoutErrorRate: 2 },
  });
  assert.equal(res.verdict, "REGRESSION");
  const latency = res.deviations.find((d) => d.metric === "checkoutLatencyMs");
  assert.equal(latency.actual, 480);
  assert.ok(latency.ratio > 2);
});

test("classifyDeviation is REGRESSION when a higher-is-better metric drops", () => {
  const res = classifyDeviation({
    predicted: { checkoutSuccessRate: 99, cacheHitRateEstimate: 90 },
    actual: { checkoutSuccessRate: 80, cacheHitRateEstimate: 90 },
  });
  assert.equal(res.verdict, "REGRESSION");
});

test("classifyDeviation is UNKNOWN when no metrics are comparable", () => {
  const res = classifyDeviation({
    predicted: { cacheHitRateEstimate: 95 },
    actual: { peakConnections: 1200 },
  });
  assert.equal(res.verdict, "UNKNOWN");
  assert.equal(res.deviations.length, 0);
});

test("classifyDeviation is DEGRADED when a metric moves significantly but not as a regression", () => {
  const res = classifyDeviation({
    predicted: { checkoutLatencyMs: 220, checkoutSuccessRate: 99 },
    actual: { checkoutLatencyMs: 140, checkoutSuccessRate: 99 },
  });
  assert.equal(res.verdict, "DEGRADED");
});

// --- metricsOf ---
test("metricsOf flattens BusinessKpis and skips systemHealth", () => {
  const m = metricsOf({
    checkoutLatencyMs: 220,
    checkoutErrorRate: 1,
    checkoutSuccessRate: 99,
    ordersThroughputPerSec: 8.4,
    cacheHitRateEstimate: 92,
    systemHealth: "healthy",
  });
  assert.deepEqual(m, {
    checkoutLatencyMs: 220,
    checkoutErrorRate: 1,
    checkoutSuccessRate: 99,
    ordersThroughputPerSec: 8.4,
    cacheHitRateEstimate: 92,
  });
  assert.equal(m.systemHealth, undefined);
});

// --- PredictionVsReality ---
test("PredictionVsReality.compare is UNKNOWN when actual is missing", () => {
  const pvr = new PredictionVsReality();
  pvr.recordPrediction({
    planId: "p1",
    stateVersion: 10,
    predicted: { checkoutLatencyMs: 220 },
    predictedHealth: "healthy",
    assumptions: [],
    timestamp: 1,
  });
  const res = pvr.compare("p1");
  assert.equal(res.verdict, "UNKNOWN");
  assert.ok(res.reason);
});

test("PredictionVsReality.compare is UNKNOWN when prediction is missing", () => {
  const pvr = new PredictionVsReality();
  pvr.recordActual({
    planId: "p2",
    stateVersion: 10,
    actual: { checkoutLatencyMs: 220 },
    actualHealth: "healthy",
    timestamp: 1,
  });
  const res = pvr.compare("p2");
  assert.equal(res.verdict, "UNKNOWN");
  assert.ok(res.reason);
});

test("PredictionVsReality full flow records prediction+actual and compares", () => {
  const plan = createPlan({
    name: "Scale cache",
    objective: "reduce checkout latency",
    actions: [{ type: "increase_cache_capacity", description: "scale cache" }],
    stateVersion: 7,
    predictedKpis: { checkoutLatencyMs: 200, checkoutErrorRate: 1 },
  });
  const pvr = new PredictionVsReality();
  pvr.recordPrediction({
    planId: plan.id,
    stateVersion: plan.stateVersion,
    predicted: plan.predictedKpis ?? {},
    predictedHealth: "healthy",
    assumptions: plan.assumptions,
    timestamp: 10,
  });
  pvr.recordActual({
    planId: plan.id,
    stateVersion: plan.stateVersion,
    actual: { checkoutLatencyMs: 420, checkoutErrorRate: 3 },
    actualHealth: "degraded",
    timestamp: 20,
  });
  const res = pvr.compare(plan.id);
  assert.equal(res.verdict, "REGRESSION");
  assert.ok(res.prediction);
  assert.ok(res.actual);
  assert.equal(res.stateVersionMatched, true);
});

test("stateVersionMatched reflects whether actual ran on the plan's state version", () => {
  const pvr = new PredictionVsReality();
  pvr.recordPrediction({
    planId: "p3",
    stateVersion: 10,
    predicted: { checkoutLatencyMs: 220 },
    predictedHealth: "healthy",
    assumptions: [],
    timestamp: 1,
  });
  pvr.recordActual({
    planId: "p3",
    stateVersion: 12,
    actual: { checkoutLatencyMs: 220 },
    actualHealth: "healthy",
    timestamp: 2,
  });
  const res = pvr.compare("p3");
  assert.equal(res.verdict, "HEALTHY");
  assert.equal(res.stateVersionMatched, false);
});