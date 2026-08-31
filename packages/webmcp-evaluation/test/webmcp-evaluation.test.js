import { test } from "node:test";
import assert from "node:assert/strict";

import { WebMCPRuntime, planForTask, runEvaluation } from "../dist/index.js";

/** Get the first plan id produced by a fresh runtime on the given goal. */
async function firstPlanId(run, registry) {
  await registry.invoke("inspect_system", {});
  await registry.invoke("investigate", {});
  const plans = await registry.invoke("generate_plans", {});
  assert.equal(plans.ok, true, "generate_plans should succeed");
  const data = plans.data;
  assert.ok(data && Array.isArray(data.plans) && data.plans.length > 0, "should produce at least one plan");
  return data.plans[0].id;
}

test("17.1 tool selection: investigating picks the right tools", async () => {
  const run = new WebMCPRuntime();
  const reg = run.registry;
  const calls = planForTask("investigate").calls;
  const out = [];
  for (const c of calls) out.push(await reg.invoke(c.name, c.args));
  // inspect_system first, then investigate
  assert.equal(calls[0].name, "inspect_system");
  assert.equal(calls[1].name, "investigate");
  assert.equal(out[0].ok, true);
  assert.equal(out[1].ok, true);
  assert.ok(out[1].data, "investigate should return an investigation result");
});

test("17.2 parameter handling: wrong-type, missing and unknown fields are rejected", async () => {
  const run = new WebMCPRuntime();
  const reg = run.registry;
  // Advance into PLAN_READY so simulate_plan is available and we exercise
  // parameter (schema) validation rather than state-availability gating.
  await reg.invoke("inspect_system", {});
  await reg.invoke("investigate", {});
  await reg.invoke("generate_plans", {});
  const calls = planForTask("sloppy").calls;
  const r1 = await reg.invoke(calls[0].name, calls[0].args);
  const r2 = await reg.invoke(calls[1].name, calls[1].args);
  const r3 = await reg.invoke(calls[2].name, calls[2].args);
  assert.equal(r1.ok, false, "wrong-typed planId must be rejected");
  assert.ok(r1.validation && r1.validation.length > 0, "wrong-typed input should surface validation errors");
  assert.equal(r2.ok, false, "missing planId must be rejected");
  assert.ok(r2.validation && r2.validation.length > 0);
  assert.equal(r3.ok, false, "unknown field must be rejected");
  assert.ok(r3.validation && r3.validation.length > 0);
});

test("17.3 multi-step: full observe→plan→simulate→prepare→approve→execute→verify lifecycle", async () => {
  const run = new WebMCPRuntime();
  const reg = run.registry;
  const planId = await firstPlanId(run, reg);
  assert.ok(planId, "expected a plan id");

  const sim = await reg.invoke("simulate_plan", { planId });
  assert.equal(sim.ok, true, "simulate_plan should succeed");

  const prep = await reg.invoke("prepare_change", { planId });
  assert.equal(prep.ok, true, "prepare_change should be accepted through the gate");

  // Human approval before execution (agent cannot self-approve).
  run.humanApprove();

  const exec = await reg.invoke("execute_change", { planId });
  assert.equal(exec.ok, true, "execute_change should succeed after approval");

  const verify = await reg.invoke("verify_change", { planId });
  assert.equal(verify.ok, true, "verify_change should return a comparison result");
  assert.ok(verify.data && "verdict" in verify.data, "verify should produce a verdict");
});

test("17.4 safety: mutation without approval/authority is blocked", async () => {
  const run = new WebMCPRuntime();
  const reg = run.registry;
  const planId = await firstPlanId(run, reg);
  // Prepare a real plan but never obtain human approval.
  await reg.invoke("simulate_plan", { planId });
  await reg.invoke("prepare_change", { planId });

  const exec = await reg.invoke("execute_change", { planId });
  assert.equal(exec.ok, false, "execute_change with no approval must be blocked");
  const rollback = await reg.invoke("rollback_change", { planId });
  assert.equal(rollback.ok, false, "rollback with no authority must be blocked");
  const phantom = await reg.invoke("prepare_change", { planId: "plan_nope" });
  assert.equal(phantom.ok, false, "phantom/unknown plan must be rejected");
});

test("17.5 recovery: failed execution leads to a valid recovery action", async () => {
  const run = new WebMCPRuntime();
  const reg = run.registry;
  const planId = await firstPlanId(run, reg);
  await reg.invoke("simulate_plan", { planId });
  await reg.invoke("prepare_change", { planId });
  run.humanApprove();

  // Force a mid-run execution failure.
  run.injectExecutionError = "simulated deployment failure during apply";
  const exec = await reg.invoke("execute_change", { planId });
  assert.equal(exec.ok, false, "execution should fail due to injected error");
  assert.ok(exec.error, "the failure reason should be surfaced");

  // Agent decides to recover.
  const rec = await reg.invoke("rollback_change", { planId });
  assert.equal(rec.ok, true, "rollback should be accepted after a failure");
  assert.ok(rec.data && "health" in rec.data);
});

test("runEvaluation: all five Phase 17 dimensions pass over the real surface", async () => {
  const report = await runEvaluation();
  assert.equal(report.overall, "PASS", `evaluation should pass, got: ${JSON.stringify(report.dimensions, null, 2)}`);
  assert.equal(report.passed, report.total);
  assert.equal(report.total, 5);
  for (const d of report.dimensions) {
    assert.equal(d.pass, true, `dimension ${d.id} (${d.name}) should pass`);
  }
});
