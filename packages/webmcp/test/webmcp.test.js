import { test } from "node:test";
import assert from "node:assert/strict";

import { TOOLS, getTool, toolAvailableInState } from "../dist/tools.js";
import { WebmcpRegistry } from "../dist/registry.js";
import { registerWithWebmcp, webmcpAvailable } from "../dist/adapter.js";

// A scripted runtime for the registry.
function makeRuntime(state, handlers = {}) {
  const calls = [];
  return {
    calls,
    runtime: {
      workflowState: () => state,
      execute: async (name, args) => {
        calls.push({ name, args });
        const h = handlers[name];
        if (h) return { ok: true, data: h(args) };
        if (name.startsWith("execute_") || name === "rollback_change") {
          return { ok: false, error: "not authorized" };
        }
        return { ok: true, data: { name, args } };
      },
    },
  };
}

// --- Tool surface ---
test("tool surface has the expected semantic tools", () => {
  const names = TOOLS.map((t) => t.name);
  for (const n of ["inspect_system", "investigate", "generate_plans", "simulate_plan", "prepare_change", "execute_change", "verify_change", "rollback_change"]) {
    assert.ok(names.includes(n), `missing ${n}`);
  }
  assert.ok(TOOLS.length >= 12);
});

test("mutation tools are flagged non-read-only; observation tools are read-only", () => {
  assert.equal(getTool("inspect_system").readOnly, true);
  assert.equal(getTool("simulate_plan").readOnly, true);
  assert.equal(getTool("execute_change").readOnly, false);
  assert.equal(getTool("rollback_change").readOnly, false);
});

test("tools are state-aware (not invocable outside their states)", () => {
  assert.equal(toolAvailableInState("inspect_system", "INVESTIGATING"), true);
  assert.equal(toolAvailableInState("execute_change", "INVESTIGATING"), false);
  assert.equal(toolAvailableInState("execute_change", "APPROVED"), true);
  assert.equal(toolAvailableInState("simulate_plan", "APPROVED"), false);
});

// --- Discovery ---
test("discover reports current availability", () => {
  const { runtime } = makeRuntime("APPROVED");
  const reg = new WebmcpRegistry(runtime);
  const list = reg.discover();
  const exec = list.find((t) => t.name === "execute_change");
  assert.equal(exec.available, true);
  assert.equal(exec.readOnly, false);
  const sim = list.find((t) => t.name === "simulate_plan");
  assert.equal(sim.available, false);
});

// --- Input validation ---
test("validation rejects missing required fields", async () => {
  const { runtime } = makeRuntime("PLAN_READY");
  const reg = new WebmcpRegistry(runtime);
  const res = await reg.invoke("simulate_plan", {});
  assert.equal(res.ok, false);
  assert.ok(res.validation.includes("missing required field 'planId'"));
});

test("validation rejects unknown fields", async () => {
  const { runtime } = makeRuntime("PLAN_READY");
  const reg = new WebmcpRegistry(runtime);
  const res = await reg.invoke("simulate_plan", { planId: "p1", evil: 1 });
  assert.equal(res.ok, false);
  assert.ok(res.validation.includes("unknown field 'evil'"));
});

test("validation accepts valid input", async () => {
  const { runtime } = makeRuntime("PLAN_READY");
  const reg = new WebmcpRegistry(runtime);
  const res = await reg.invoke("simulate_plan", { planId: "p1" });
  assert.equal(res.ok, true);
});

// --- State gating ---
test("invoking an out-of-state mutation tool is blocked", async () => {
  const { runtime } = makeRuntime("SIMULATED"); // not APPROVED -> execute blocked
  const reg = new WebmcpRegistry(runtime);
  const res = await reg.invoke("execute_change", { planId: "p1" });
  assert.equal(res.ok, false);
  assert.match(res.error, /not available in the current workflow state/);
});

test("a mutation tool in the wrong state never reaches the runtime", async () => {
  const { runtime, calls } = makeRuntime("SIMULATED");
  const reg = new WebmcpRegistry(runtime);
  await reg.invoke("execute_change", { planId: "p1" });
  assert.equal(calls.length, 0); // runtime never executed it
});

// --- Runtime delegation ---
test("read-only tool delegates to runtime and returns data", async () => {
  const { runtime, calls } = makeRuntime("INVESTIGATING", {
    investigate: (a) => ({ evidence: ["e1"] }),
  });
  const reg = new WebmcpRegistry(runtime);
  const res = await reg.invoke("investigate", {});
  assert.equal(res.ok, true);
  assert.equal(res.data.evidence[0], "e1");
  assert.equal(calls.length, 1);
});

// --- WebMCP adapter (feature detection) ---
test("adapter is a safe no-op when WebMCP host is unavailable", () => {
  // In Node there is no document.modelContext, so registration returns [].
  assert.equal(webmcpAvailable(), false);
});

test("adapter registers tools when a host is present", async () => {
  const registered = {};
  const fakeHost = {
    registerTool: (t) => { registered[t.name] = t; },
  };
  (globalThis).document = { modelContext: fakeHost };
  try {
    assert.equal(webmcpAvailable(), true);
    const names = await registerWithWebmcp(makeRuntime("IDLE").runtime);
    assert.ok(names.includes("inspect_system"));
    assert.ok(names.includes("execute_change"));
    assert.equal(typeof registered["execute_change"].execute, "function");
  } finally {
    delete (globalThis).document;
  }
});
