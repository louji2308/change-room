import { test } from "node:test";
import assert from "node:assert/strict";
import { loadAgentModel, MockModel, FallbackAgentModel } from "../dist/model/index.js";

test("model: MockModel is deterministic and offline", async () => {
  const m = new MockModel();
  const a = await m.complete([{ role: "user", content: "propose a plan" }]);
  const b = await m.complete([{ role: "user", content: "propose a plan" }]);
  assert.equal(a.text, b.text);
  assert.equal(a.isMock, true);
  assert.equal(a.provider, "mock");
  assert.ok(a.text.includes("plan"));
  // fallthrough default for unrecognized input
  const c = await m.complete([{ role: "user", content: "anything else" }]);
  assert.equal(c.text, "[mock] ok");
});

test("model: factory returns mock when no provider key is configured", () => {
  const { model, isMock } = loadAgentModel({ forceMock: true });
  assert.equal(isMock, true);
  assert.equal(model.describe().isMock, true);
});

test("model: factory without keys is graceful (no throw, isMock)", () => {
  // Provide empty env object — no process.env leak in tests.
  const { model, isMock } = loadAgentModel({
    nvidiaKey: undefined,
    mistralKey: undefined,
    openrouterKey: undefined,
  });
  assert.equal(isMock, true);
  assert.equal(model.describe().provider, "mock");
});

test("model: FallbackAgentModel with zero keys has no live provider", () => {
  const m = new FallbackAgentModel({
    nvidiaKey: undefined,
    mistralKey: undefined,
    openrouterKey: undefined,
  });
  assert.equal(m.hasLiveProvider, false);
});
