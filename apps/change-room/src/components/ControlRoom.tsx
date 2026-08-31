"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, getState, type SessionResponse, type View } from "@/lib/api";
import { SystemPanel, IncidentPanel, EvidencePanel, HypothesesPanel, PlansPanel, SimulationPanel } from "@/components/panels";
import { ApprovalPanel, VerificationPanel, TimelinePanel, DelegationPanel } from "@/components/control";

const ACTIONS: Array<{ id: string; label: string; needs?: string[]; danger?: boolean; body?: (v: View) => Record<string, unknown> }> = [
  { id: "start", label: "Start scenario", needs: ["IDLE", "COMPLETE", "RECOVERING"] },
  { id: "reason", label: "Agent: reason", needs: ["CONTRACT_SET", "INVESTIGATING"], body: () => ({ goal: "restore system health" }) },
  { id: "prepare", label: "Prepare change", needs: ["SIMULATED"] },
  { id: "approve", label: "Approve", needs: ["WAITING_FOR_APPROVAL"] },
  { id: "execute", label: "Execute", needs: ["APPROVED"], danger: true },
  { id: "verify", label: "Verify", needs: ["EXECUTED"] },
  { id: "rollback", label: "Rollback", needs: ["EXECUTED", "DEVIATION"], danger: true },
  { id: "reject", label: "Reject", needs: ["WAITING_FOR_APPROVAL"], danger: true },
  { id: "reset", label: "Reset", needs: [] },
];

const STEPS = [
  "CONTRACT_SET",
  "INVESTIGATING",
  "PLAN_READY",
  "SIMULATED",
  "WAITING_FOR_APPROVAL",
  "APPROVED",
  "EXECUTING",
  "EXECUTED",
  "VERIFYING",
  "COMPLETE",
] as const;

const ACTIVE_STATES = new Set(["EXECUTING", "EXECUTED", "VERIFYING", "RECOVERING", "SIMULATING"]);
const ERROR_STATES = new Set(["DEVIATION", "RECOVERING"]);

function stepStatus(step: string, current: string): "past" | "current" | "future" {
  const ci = STEPS.indexOf(step as any);
  const cur = STEPS.indexOf(current as any);
  if (ci < cur) return "past";
  if (ci === cur) return "current";
  return "future";
}

function WorkflowStepper({ workflow }: { workflow: string }) {
  const normalized = workflow === "IDLE" ? "" : workflow;
  return (
    <nav className="stepper" role="navigation" aria-label="Workflow progress">
      {STEPS.map((step, i) => {
        const status = normalized ? stepStatus(step, normalized) : "future";
        const cls = [
          "step",
          status === "past" ? "step-past" : "",
          status === "current" ? `step-current${ACTIVE_STATES.has(workflow) ? " step-pulse" : ""}` : "",
          status === "future" ? "step-future" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <span key={step} style={{ display: "contents" }}>
            {i > 0 && <span className="step-connector" aria-hidden="true" />}
            <span className={cls} aria-current={status === "current" ? "step" : undefined}>
              <span className="step-dot" aria-hidden="true" />
              {step.replace(/_/g, " ")}
            </span>
          </span>
        );
      })}
    </nav>
  );
}

export default function ControlRoom() {
  const [view, setView] = useState<View | null>(null);
  const [scenarios, setScenarios] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const loadKey = useRef(0);

  const load = useCallback(async (show?: boolean) => {
    const key = ++loadKey.current;
    try {
      const data = await getState();
      if (key === loadKey.current) {
        setView(data);
        setScenarios((prev) => (prev.length ? prev : []));
      }
    } catch (e) {
      if (key === loadKey.current) setError(String(e));
    }
    void show;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/session", { cache: "no-store" });
        const json = await res.json();
        setView(json.view);
        setScenarios(json.scenarios ?? []);
        setError(null);
        // eslint-disable-next-line no-console
        console.info(`[Change Room] initial state: ${json.view?.workflow ?? "none"}`);
      } catch (e) {
        setError(String(e));
      }
    })();
    const t = setInterval(() => load(false), 3000);
    return () => clearInterval(t);
  }, [load]);

  const run = useCallback(
    async (id: string, body?: Record<string, unknown>) => {
      setBusy(id);
      setError(null);
      setFlash(null);
      try {
        const res: SessionResponse = await api(id, body);
        if (res.view) setView(res.view);
        setScenarios((prev) => (prev.length ? prev : (res.scenarios ?? prev)));
        if (res.ok) setFlash(`${id} ok`);
        else setError(res.error ?? "operation failed");
        if (res.verification?.verdict?.verdict) setFlash(`verdict: ${res.verification.verdict.verdict}`);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(null);
      }
    },
    []
  );

  const available = useMemo(() => {
    const wf = view?.workflow ?? "IDLE";
    return ACTIONS.filter((a) => a.needs!.length === 0 || a.needs!.includes(wf));
  }, [view?.workflow]);

  if (!view) {
    return (
      <div style={{ padding: "1rem", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
          <h1>Change Room</h1>
        </div>
        {error ? (
          <div role="alert" className="alert alert-error">
            <span className="alert-icon" aria-hidden="true">!</span>
            <span>Error loading session: {error}</span>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "0.75rem" }} role="status" aria-label="Loading Change Room">
            <div className="skeleton" />
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        )}
      </div>
    );
  }

  const start = (
    <select
      aria-label="Scenario"
      className="button"
      defaultValue="cache-failure"
      style={{ background: "var(--bg)", color: "var(--text)" }}
      onChange={(e) => run("start", { scenarioId: e.target.value })}
    >
      {(scenarios.length ? scenarios : [{ id: "cache-failure", name: "Cache Slowdown" }]).map((s) => (
        <option key={s.id} value={s.id}>
          {s.name || s.id}
        </option>
      ))}
    </select>
  );

  const isBusy = busy !== null;
  const isActive = ACTIVE_STATES.has(view.workflow);

  return (
    <div style={{ padding: "1rem", maxWidth: 1280, margin: "0 auto" }}>
      <header className={`spread${isActive ? " header-active" : ""}`} style={{ marginBottom: "0.5rem" }}>
        <div className="row" style={{ gap: "0.75rem" }}>
          <h1>Change Room</h1>
          <span className="badge" role="status" aria-label={`Workflow status: ${view.workflow}`}>
            <span className={`dot ${view.paused ? "dot-warn" : ERROR_STATES.has(view.workflow) ? "dot-danger" : view.workflow === "COMPLETE" ? "dot-ok" : "dot-info"}`} />
            {view.paused ? "PAUSED — " : ""}
            {view.statusLabel} ({view.workflow})
          </span>
        </div>
        <span className="text-faint mono" style={{ fontSize: 12 }}>
          shared human + AI operational control
        </span>
      </header>

      <WorkflowStepper workflow={view.workflow} />

      <div aria-live="polite" aria-atomic="true" style={{ minHeight: 0 }}>
        {error && (
          <div
            role="alert"
            className="alert alert-error"
            style={{ marginTop: "var(--sp-3)", marginBottom: "var(--sp-3)" }}
          >
            <span className="alert-icon" aria-hidden="true">!</span>
            <span>{error}</span>
          </div>
        )}

        {flash && (
          <div
            role="status"
            className="alert alert-flash"
            style={{ marginTop: "var(--sp-3)", marginBottom: "var(--sp-3)" }}
          >
            <span className="alert-icon" aria-hidden="true">&#10003;</span>
            <span>{flash}</span>
          </div>
        )}
      </div>

      <div className="statusbar" style={{ margin: "var(--sp-3) 0" }}>
        <span className="text-dim" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Controls
        </span>
        {start}
        <span className="rail">
          {available.map((a) => (
            <button
              key={a.id}
              className={`button${a.danger ? " button-danger" : ""}${a.id === "approve" ? " button-primary" : ""}`}
              disabled={isBusy}
              onClick={() => run(a.id, a.body?.(view))}
              aria-busy={busy === a.id || undefined}
            >
              {busy === a.id ? <><span className="spinner" aria-hidden="true" />Working…</> : a.label}
            </button>
          ))}
        </span>
        {isBusy && (
          <span className="busy-indicator" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            Executing {busy}…
          </span>
        )}
      </div>

      <div className="stack" style={{ marginTop: "var(--sp-2)" }}>
        <SystemPanel view={view} />
        <div className="grid-2">
          <IncidentPanel view={view} />
          <EvidencePanel view={view} />
        </div>
        <div className="grid-2">
          <HypothesesPanel view={view} />
          <SimulationPanel view={view} />
        </div>
        <PlansPanel view={view} />
        <div className="grid-2">
          <ApprovalPanel view={view} />
          <VerificationPanel view={view} />
        </div>
        <DelegationPanel view={view} />
        <TimelinePanel view={view} />
      </div>
    </div>
  );
}
