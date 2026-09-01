"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, getState, type View } from "@/lib/api";

type Tone = "ok" | "err" | "cy" | "dim";
interface Line {
  id: number;
  word: string;
  detail: string;
  tone?: Tone;
}

const MAX_LINES = 16;
const DEFAULT_SCENARIO = "cache-failure";

let globalRan = false;
let autoplayStarted = false;

function short(s: unknown, max = 110): string {
  const t = typeof s === "string" ? s : "";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function toneForType(type: string): Tone {
  if (type === "error" || type === "execution_failed") return "err";
  if (type === "verification") return "ok";
  if (type === "policy_checked" || type === "approval_requested") return "cy";
  return "dim";
}

export default function WorkflowTerminal() {
  const [lines, setLines] = useState<Line[]>([]);
  const [replay, setReplay] = useState(true);
  const idRef = useRef(0);

  const push = useCallback((line: Omit<Line, "id">) => {
    setLines((prev) => [...prev.slice(-(MAX_LINES - 1)), { id: ++idRef.current, ...line }]);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reduced = mq.matches;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, reduced ? 0 : ms * 0.55));

    const fail = (label: string, detail: string) => {
      push({ word: label, detail, tone: "err" });
    };

    const autoplay = async () => {
      await sleep(450);

      if (globalRan) {
        const view = await getState().catch(() => null);
        if (!view) return;
        renderRecap(view);
        return;
      }

      const view0 = await getState().catch(() => null);
      if (view0 && view0.workflow !== "IDLE") {
        renderRecap(view0);
        return;
      }
      await runLive();
    };

    const renderRecap = (view: View) => {
      const steps = (view.flight?.steps ?? []) as Array<{ type: string; resultSummary: string }>;
      const tail = steps.slice(-7);
      for (const s of tail) {
        push({ word: s.type ?? "step", detail: short(s.resultSummary), tone: toneForType(s.type) });
      }
      push({ word: "state", detail: `${view.workflow} · health=${view.health}`, tone: "ok" });
      setReplay(false);
    };

    const runLive = async () => {
      globalRan = true;
      push({ word: "start", detail: `detected incident · ${DEFAULT_SCENARIO}`, tone: "cy" });
      await sleep(140);
      const s = await api("start", { scenarioId: DEFAULT_SCENARIO }).catch(() => null);
      if (!s?.ok) return fail("start", s?.error ?? "sandbox unreachable");
      await sleep(240);

      push({ word: "reason", detail: "agent formed hypotheses from observable evidence" });
      await sleep(120);
      const r = await api("reason", { goal: "restore system health" }).catch(() => null);
      if (!r?.ok) return fail("reason", r?.error ?? "no plans");
      const plans = r.view?.plans ?? [];
      if (plans.length === 0) return fail("plan", "agent produced no plans");
      await sleep(220);

      const plan = plans[0];
      const planLabel = `${plan.name} · risk=${plan.risk?.overall ?? "?"}`;
      push({ word: "plan", detail: `selected ${plan.id} ${planLabel}`, tone: "cy" });
      await sleep(120);
      const sel = await api("select", { planId: plan.id }).catch(() => null);
      if (!sel?.ok) return fail("select", sel?.error ?? "cannot select plan");
      const sim = sel.view?.simulations?.[0];
      await sleep(220);

      if (sim?.prediction) {
        push({
          word: "simulate",
          detail: `predicted systemHealth ${String(sim.prediction.kpis?.systemHealth ?? "?")} on ${plan.actions?.[0]?.type ?? "no-op"}`,
        });
        await sleep(140);
      }

      push({ word: "gate", detail: "change-control policy check", tone: "cy" });
      await sleep(120);
      const g = await api("prepare").catch(() => null);
      if (!g?.ok) return fail("gate", g?.error ?? "policy check failed");
      const gate = g.gate ?? {};
      if (gate.approvalRequired) {
        push({ word: "approve", detail: `WAITING FOR HUMAN · ${gate.reason ?? "approval required"}`, tone: "err" });
        await sleep(500);
        const a = await api("approve").catch(() => null);
        if (!a?.ok) return fail("approve", a?.error ?? "approval failed");
        push({ word: "human", detail: "shared-control: human approved the change plan", tone: "ok" });
        await sleep(200);
      } else {
        push({ word: "gate", detail: `auto-approved within bounds · ${gate.stage ?? "unrestricted"}`, tone: "ok" });
      }
      await sleep(200);

      push({ word: "execute", detail: `applying ${plan.actions?.[0]?.type ?? "change"} …`, tone: "dim" });
      await sleep(160);
      const e = await api("execute").catch(() => null);
      if (!e?.ok) return fail("execute", e?.error ?? "execution failed");
      push({
        word: "execute",
        detail: `done · ok=${String(e.execution?.ok)} health=${e.view?.health ?? "?"}`,
        tone: "ok",
      });
      await sleep(200);

      const v = await api("verify").catch(() => null);
      if (!v?.ok) return fail("verify", v?.error ?? "verification failed");
      const verdict = v.verification?.verdict;
      push({
        word: "verify",
        detail: verdict === "HEALTHY" ? "prediction vs reality matched · no deviation" : short(verdict),
        tone: verdict === "HEALTHY" ? "ok" : "err",
      });
      await sleep(180);
      push({ word: "complete", detail: `workflow=${v.view?.workflow} health=${v.view?.health ?? "?"}`, tone: "ok" });
      setReplay(false);
    };

    if (autoplayStarted) return;
    autoplayStarted = true;

    void autoplay().catch(() => {
      fail("client", "could not reach sandbox");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="hero-terminal" role="log" aria-label="Live incident terminal">
      <div className="term-bar">
        <span className="term-dot d-red" />
        <span className="term-dot d-yellow" />
        <span className="term-dot d-green" />
        <span className="term-title">changeroom — live sandbox session</span>
      </div>
      <div className="term-body" aria-live="polite">
        {lines.map((l) => (
          <div key={l.id} className={`term-line${l.tone ? ` ${l.tone}` : ""}`}>
            <span className="idx">{String(l.id).padStart(2, "0")}</span>
            <span className="word">{l.word}</span>
            <span className="detail">{l.detail}</span>
          </div>
        ))}
        <span className="term-cursor" aria-hidden="true" />
      </div>
      <div className="term-footer">
        <span className="term-footer-note">{replay ? "streaming live events" : "last completed flow"}</span>
        {!replay && (
          <button type="button" className="term-rerun" onClick={() => window.location.reload()}>
            run again
          </button>
        )}
      </div>
    </div>
  );
}