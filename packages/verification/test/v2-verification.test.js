import { test } from "node:test";
import assert from "node:assert/strict";
import { computePredictionError, isMismatch } from "../dist/prediction-error.js";
import { analyzeOutcome } from "../dist/outcome-analysis.js";
import { extractLesson } from "../dist/lesson-extractor.js";

test("prediction error: computes abs + relative error per metric", () => {
  const r = computePredictionError({
    planId: "p1",
    worldRevision: 5,
    predicted: { checkoutSuccessRate: 94 },
    actual: { checkoutSuccessRate: 87 },
  });
  assert.equal(r.planId, "p1");
  const err = r.errors[0];
  assert.equal(err.metric, "checkoutSuccessRate");
  assert.equal(err.predicted, 94);
  assert.equal(err.actual, 87);
  assert.equal(err.absolute, 7);
});

test("prediction error: flags mismatch beyond threshold", () => {
  const ok = computePredictionError({
    planId: "p1",
    worldRevision: 5,
    predicted: { checkoutSuccessRate: 94 },
    actual: { checkoutSuccessRate: 92 },
    threshold: 0.1,
  });
  assert.equal(ok.mismatched, false);

  const bad = computePredictionError({
    planId: "p1",
    worldRevision: 5,
    predicted: { checkoutSuccessRate: 94 },
    actual: { checkoutSuccessRate: 60 },
    threshold: 0.1,
  });
  assert.equal(bad.mismatched, true);
  assert.ok(isMismatch(bad, 0.1));
});

test("prediction error: state drift attribution", () => {
  const r = computePredictionError({
    planId: "p1",
    worldRevision: 7,
    predicted: { checkoutSuccessRate: 90 },
    actual: { checkoutSuccessRate: 50 },
    stateDrifted: true,
  });
  assert.equal(r.attribution, "state-drift");
  assert.match(r.cause, /world advanced/i);
});

test("outcome analysis: regression routes to reinvestigate, never success", () => {
  const o = analyzeOutcome({ planId: "p1", verdict: "REGRESSION", successRate: 60, latencyMs: 200 });
  assert.equal(o.kind, "FAILURE");
  assert.equal(o.nextAction, "reinvestigate");

  const deviation = analyzeOutcome({ planId: "p1", verdict: "REGRESSION", successRate: 82, latencyMs: 150 });
  assert.equal(deviation.kind, "DEVIATION");
  assert.equal(deviation.nextAction, "reinvestigate");
});

test("outcome analysis: healthy success stays SUCCESS", () => {
  const o = analyzeOutcome({ planId: "p1", verdict: "HEALTHY", successRate: 98, latencyMs: 40 });
  assert.equal(o.kind, "SUCCESS");
  assert.equal(o.nextAction, "verify");
});

test("outcome analysis: partial recovery below healthy bar", () => {
  const o = analyzeOutcome({ planId: "p1", verdict: "HEALTHY", successRate: 85, latencyMs: 60 });
  assert.equal(o.kind, "PARTIAL_RECOVERY");
  assert.equal(o.nextAction, "verify");
});

test("lesson extractor: persists structured lesson", () => {
  const l = extractLesson({
    planId: "p1",
    worldRevision: 5,
    predicted: { checkoutSuccessRate: 94 },
    actual: { checkoutSuccessRate: 87 },
    error: { attribution: "model-underestimate", cause: "dynamics stronger than modeled" },
    outcomeKind: "DEVIATION",
    nextAction: "reinvestigate",
  });
  assert.match(l.lessonId, /^lesson_/);
  assert.equal(l.outcomeKind, "DEVIATION");
  assert.match(l.text, /predicted \{checkoutSuccessRate=94\}/);
});
