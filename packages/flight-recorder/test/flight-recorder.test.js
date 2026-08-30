import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FlightRecorder,
  buildReplay,
  redacted,
} from "../dist/index.js";

test("record assigns increasing seq and preserves order", () => {
  const fr = new FlightRecorder();
  const a = fr.record({ actor: "agent", type: "observation" });
  const b = fr.record({ actor: "agent", type: "hypothesis_added" });
  const c = fr.record({ actor: "human", type: "human_approved" });
  assert.equal(a.seq, 1);
  assert.equal(b.seq, 2);
  assert.equal(c.seq, 3);
  assert.ok(b.timestamp >= a.timestamp);
});

test("all() returns events in chronological insertion order", () => {
  const fr = new FlightRecorder();
  fr.record({ actor: "system", type: "intent_contract_set" });
  fr.record({ actor: "agent", type: "observation" });
  fr.record({ actor: "agent", type: "plan_generated" });
  const all = fr.all();
  assert.equal(all.length, 3);
  assert.deepEqual(
    all.map((e) => e.type),
    ["intent_contract_set", "observation", "plan_generated"]
  );
});

test("redaction strips password/token fields from detail before storage", () => {
  const fr = new FlightRecorder();
  fr.record({
    actor: "agent",
    type: "verification",
    detail: { url: "https://example.com", password: "hunter2", token: "abc123" },
  });
  const stored = fr.all()[0];
  assert.equal(stored.detail.password, undefined);
  assert.equal(stored.detail.token, undefined);
  assert.equal(stored.detail.url, "https://example.com");
});

test("redacted() strips secret fields case-insensitively", () => {
  const out = redacted({ APIKEY: "x", Credential: "y", keep: 1 });
  assert.equal(out.APIKEY, undefined);
  assert.equal(out.Credential, undefined);
  assert.deepEqual(out.keep, 1);
});

test("forPlan filters by planId", () => {
  const fr = new FlightRecorder();
  fr.record({ actor: "agent", type: "plan_generated", planId: "p1" });
  fr.record({ actor: "agent", type: "plan_generated", planId: "p2" });
  fr.record({ actor: "agent", type: "execution_started", planId: "p1" });
  const p1 = fr.forPlan("p1");
  assert.equal(p1.length, 2);
  assert.ok(p1.every((e) => e.planId === "p1"));
});

test("byType filters", () => {
  const fr = new FlightRecorder();
  fr.record({ actor: "agent", type: "observation" });
  fr.record({ actor: "agent", type: "observation" });
  fr.record({ actor: "agent", type: "plan_generated" });
  const obs = fr.byType("observation");
  assert.equal(obs.length, 2);
  assert.ok(obs.every((e) => e.type === "observation"));
});

test("since returns events after a sequence number", () => {
  const fr = new FlightRecorder();
  fr.record({ actor: "agent", type: "observation" });
  fr.record({ actor: "agent", type: "hypothesis_added" });
  fr.record({ actor: "human", type: "human_approved" });
  const after = fr.since(1);
  assert.equal(after.length, 2);
  assert.deepEqual(
    after.map((e) => e.seq),
    [2, 3]
  );
});

test("replay returns steps in seq order (no out-of-order)", () => {
  const fr = new FlightRecorder();
  fr.record({ actor: "system", type: "intent_contract_set" });
  fr.record({ actor: "agent", type: "observation" });
  fr.record({ actor: "agent", type: "incident_complete" });
  const { steps } = fr.replay();
  assert.equal(steps.length, 3);
  assert.deepEqual(
    steps.map((s) => s.seq),
    [1, 2, 3]
  );
  assert.ok(steps.every((s) => typeof s.summary === "string" && s.summary.length > 0));
});

test("incomplete timeline (no incident_complete) → partial true, complete false", () => {
  const fr = new FlightRecorder();
  fr.record({ actor: "system", type: "intent_contract_set" });
  fr.record({ actor: "agent", type: "observation" });
  const replay = fr.replay();
  assert.equal(replay.complete, false);
  assert.equal(replay.partial, true);
});

test("complete timeline → complete true", () => {
  const fr = new FlightRecorder();
  fr.record({ actor: "system", type: "intent_contract_set" });
  fr.record({ actor: "agent", type: "observation" });
  fr.record({ actor: "agent", type: "incident_complete" });
  const replay = fr.replay();
  assert.equal(replay.complete, true);
  assert.equal(replay.partial, false);
});

test("summary counts by type and actor correctly", () => {
  const fr = new FlightRecorder();
  fr.record({ actor: "agent", type: "observation" });
  fr.record({ actor: "agent", type: "observation" });
  fr.record({ actor: "human", type: "human_approved" });
  fr.record({ actor: "system", type: "incident_complete" });
  const s = fr.summary();
  assert.equal(s.count, 4);
  assert.equal(s.byType.observation, 2);
  assert.equal(s.byType.human_approved, 1);
  assert.equal(s.byActor.agent, 2);
  assert.equal(s.byActor.human, 1);
  assert.equal(s.firstSeq, 1);
  assert.equal(s.lastSeq, 4);
});

test("gap detection: crafted missing seq → missingGaps > 0", () => {
  const base = { timestamp: Date.now(), actor: "agent" };
  const events = [
    { ...base, seq: 1, type: "intent_contract_set" },
    { ...base, seq: 2, type: "observation" },
    { ...base, seq: 4, type: "plan_generated" },
  ];
  const replay = buildReplay(events);
  assert.equal(replay.missingGaps, 1);
});

test("limit trims old events (oldest dropped)", () => {
  const fr = new FlightRecorder({ limit: 3 });
  for (let i = 0; i < 5; i++) {
    fr.record({ actor: "agent", type: "observation" });
  }
  const all = fr.all();
  assert.equal(all.length, 3);
  assert.deepEqual(
    all.map((e) => e.seq),
    [3, 4, 5]
  );
});

test("realistic walk produces a complete replay ending in incident_complete", () => {
  const fr = new FlightRecorder();
  const t0 = Date.now();
  fr.record({ actor: "human", type: "intent_contract_set", timestamp: t0 });
  fr.record({ actor: "agent", type: "observation", timestamp: t0 + 1 });
  fr.record({ actor: "agent", type: "hypothesis_added", timestamp: t0 + 2 });
  fr.record({ actor: "agent", type: "plan_generated", planId: "plan-1", timestamp: t0 + 3 });
  fr.record({ actor: "agent", type: "simulation_requested", planId: "plan-1", timestamp: t0 + 4 });
  fr.record({ actor: "system", type: "policy_checked", planId: "plan-1", timestamp: t0 + 5 });
  fr.record({ actor: "agent", type: "approval_requested", planId: "plan-1", timestamp: t0 + 6 });
  fr.record({ actor: "human", type: "human_approved", planId: "plan-1", timestamp: t0 + 7 });
  fr.record({ actor: "agent", type: "execution_started", planId: "plan-1", timestamp: t0 + 8 });
  fr.record({ actor: "agent", type: "verification", planId: "plan-1", timestamp: t0 + 9 });
  fr.record({ actor: "system", type: "incident_complete", planId: "plan-1", timestamp: t0 + 10 });
  const replay = fr.replay();
  assert.equal(replay.complete, true);
  assert.equal(replay.partial, false);
  assert.equal(replay.missingGaps, 0);
  assert.equal(replay.steps.length, 11);
  assert.equal(replay.steps.at(-1).type, "incident_complete");
});
