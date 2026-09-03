import { test } from "node:test";
import assert from "node:assert/strict";

import { ALL_TOOLS, ALL_TOOL_NAMES, V2_TOOLS, V2_TOOL_NAMES, getTool } from "../dist/tools.js";
import { WebmcpRegistry } from "../dist/registry.js";
import { registerWithWebmcp } from "../dist/adapter.js";

function makeRuntime(state, ctx) {
  const calls = [];
  return {
    calls,
    runtime: {
      workflowState: () => state,
      context: ctx ? () => ctx : undefined,
      execute: async (name, args) => {
        calls.push({ name, args });
        return { ok: true, data: { name, args } };
      },
    },
  };
}

test("V2 tools are part of the canonical surface", () => {
  assert.deepEqual(
    V2_TOOL_NAMES.sort(),
    ["abstain", "inspect_decision_memory", "test_robustness"].sort()
  );
  assert.ok(V2_TOOLS.length === 3);
  assert.equal(V2_TOOLS.every((t) => t.readOnly), true);
  for (const name of ["abstain", "inspect_decision_memory", "test_robustness"]) {
    assert.ok(ALL_TOOL_NAMES.includes(name));
    assert.ok(getTool(name));
  }
});

test("discover includes V2 tools alongside V1", () => {
  const { runtime } = makeRuntime("SIMULATED", { authority: "L3" });
  const reg = new WebmcpRegistry(runtime);
  const list = reg.discover();
  const names = list.map((t) => t.name);
  assert.ok(names.includes("inspect_system"));
  assert.ok(names.includes("test_robustness"));
  assert.ok(names.includes("abstain"));
});

test("dynamic authority gating: test_robustness hidden when authority too low", () => {
  // L2 required; L1 should hide it even though state is SIMULATED (valid state).
  const low = new WebmcpRegistry(makeRuntime("SIMULATED", { authority: "L1" }).runtime);
  assert.equal(low.canUse("test_robustness"), false);
  const listedLow = low.discover().find((t) => t.name === "test_robustness");
  assert.equal(listedLow.available, false);

  const ok = new WebmcpRegistry(makeRuntime("SIMULATED", { authority: "L3" }).runtime);
  assert.equal(ok.canUse("test_robustness"), true);
  assert.equal(ok.discover().find((t) => t.name === "test_robustness").available, true);
});

test("dynamic gating: no context provider means backward-compatible (permissive)", () => {
  const { runtime } = makeRuntime("SIMULATED");
  const reg = new WebmcpRegistry(runtime);
  // Without a context provider, availability falls back to the static state
  // check alone (authority gate treated as satisfied).
  assert.equal(reg.canUse("test_robustness"), true);
  assert.equal(reg.discover().find((t) => t.name === "test_robustness").available, true);
});

test("V2 tools invoke through the registry and delegate to runtime", async () => {
  const { runtime, calls } = makeRuntime("SIMULATED", { authority: "L3" });
  const reg = new WebmcpRegistry(runtime);
  const res = await reg.invoke("test_robustness", { planId: "plan_1" });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "test_robustness");
  assert.deepEqual(calls[0].args, { planId: "plan_1" });
});

test("out-of-state V2 tool is blocked before reaching runtime", async () => {
  // test_robustness is not valid in COMPLETE
  const { runtime, calls } = makeRuntime("COMPLETE", { authority: "L4" });
  const reg = new WebmcpRegistry(runtime);
  const res = await reg.invoke("test_robustness", { planId: "p1" });
  assert.equal(res.ok, false);
  assert.equal(calls.length, 0);
});

test("test_robustness requires planId", async () => {
  const { runtime } = makeRuntime("PLAN_READY", { authority: "L3" });
  const reg = new WebmcpRegistry(runtime);
  const res = await reg.invoke("test_robustness", {});
  assert.equal(res.ok, false);
  assert.ok(res.validation.includes("missing required field 'planId'"));
});

test("abstain accepts a reason and returns structured abstention", async () => {
  const { runtime, calls } = makeRuntime("INVESTIGATING", { authority: "L3" });
  const reg = new WebmcpRegistry(runtime);
  const res = await reg.invoke("abstain", { reason: "insufficient evidence" });
  assert.equal(res.ok, true);
  assert.equal(calls[0].name, "abstain");
  assert.deepEqual(calls[0].args, { reason: "insufficient evidence" });
});

test("abstain requires a reason", async () => {
  const { runtime } = makeRuntime("INVESTIGATING", { authority: "L3" });
  const reg = new WebmcpRegistry(runtime);
  const res = await reg.invoke("abstain", {});
  assert.equal(res.ok, false);
  assert.ok(res.validation.includes("missing required field 'reason'"));
});

test("adapter registers V2 tools along with V1", async () => {
  const registered = {};
  const fakeHost = { registerTool: (t) => { registered[t.name] = t; } };
  globalThis.document = { modelContext: fakeHost };
  try {
    const names = await registerWithWebmcp(makeRuntime("SIMULATED", { authority: "L3" }).runtime);
    assert.ok(names.includes("inspect_system"));
    assert.ok(names.includes("test_robustness"));
    assert.ok(names.includes("abstain"));
    assert.ok(names.includes("inspect_decision_memory"));
    assert.equal(typeof registered["test_robustness"].execute, "function");
  } finally {
    delete globalThis.document;
  }
});
