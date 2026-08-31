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

test("no duplicate seq: N rapid records produce N distinct seqs", () => {
  const fr = new FlightRecorder();
  const N = 200;
  const seqs = new Set();
  for (let i = 0; i < N; i++) {
    const e = fr.record({ actor: "agent", type: "observation", detail: { i } });
    seqs.add(e.seq);
  }
  assert.equal(seqs.size, N, "every seq must be unique");
  assert.equal(fr.all().length, N);
});

test("deduplicate: consecutive identical events are rejected", () => {
  const fr = new FlightRecorder({ deduplicate: true });
  const a = fr.record({ actor: "agent", type: "observation", detail: { msg: "same" } });
  const b = fr.record({ actor: "agent", type: "observation", detail: { msg: "same" } });
  const c = fr.record({ actor: "agent", type: "observation", detail: { msg: "same" } });
  assert.equal(fr.all().length, 1, "only one event stored");
  assert.equal(a.seq, b.seq, "dedup returns same seq");
  assert.equal(b.seq, c.seq);
});

test("deduplicate: non-consecutive identical events are kept", () => {
  const fr = new FlightRecorder({ deduplicate: true });
  fr.record({ actor: "agent", type: "observation", detail: { x: 1 } });
  fr.record({ actor: "agent", type: "hypothesis_added", detail: { x: 1 } });
  fr.record({ actor: "agent", type: "observation", detail: { x: 1 } });
  assert.equal(fr.all().length, 3, "all three kept (different types in between)");
});

test("summary counts match replay after dedup", () => {
  const fr = new FlightRecorder({ deduplicate: true });
  fr.record({ actor: "agent", type: "observation", detail: { v: 1 } });
  fr.record({ actor: "agent", type: "observation", detail: { v: 1 } });
  fr.record({ actor: "agent", type: "observation", detail: { v: 2 } });
  fr.record({ actor: "human", type: "human_approved" });
  const s = fr.summary();
  const r = fr.replay();
  assert.equal(s.count, r.steps.length, "summary count must match replay steps");
  assert.equal(s.count, 3);
  assert.equal(s.byType.observation, 2);
  assert.equal(s.byType.human_approved, 1);
});

test("reset clears all events and resets seq", () => {
  const fr = new FlightRecorder();
  fr.record({ actor: "agent", type: "observation" });
  fr.record({ actor: "agent", type: "hypothesis_added" });
  assert.equal(fr.all().length, 2);
  fr.reset();
  assert.equal(fr.all().length, 0);
  const e = fr.record({ actor: "agent", type: "observation" });
  assert.equal(e.seq, 1, "seq resets to 1 after reset");
});

test("bounded growth: limit caps events across many records", () => {
  const fr = new FlightRecorder({ limit: 50 });
  for (let i = 0; i < 500; i++) {
    fr.record({ actor: "agent", type: "observation", detail: { i } });
  }
  assert.equal(fr.all().length, 50, "event count must not exceed limit");
  const s = fr.summary();
  assert.equal(s.count, 50);
  assert.equal(s.firstSeq, 451, "oldest retained seq");
  assert.equal(s.lastSeq, 500);
  const r = fr.replay();
  assert.equal(r.steps.length, 50, "replay must match stored count");
});
