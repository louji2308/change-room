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
          <div role="alert" className="empty text-danger">
            Error loading session: {error}
            <br />
            <button className="button" onClick={() => window.location.reload()} style={{ marginTop: "0.5rem" }}>
              Reload
            </button>
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

  return (
    <div style={{ padding: "1rem", maxWidth: 1280, margin: "0 auto" }}>
      <header className="spread" style={{ marginBottom: "1rem" }}>
        <div className="row" style={{ gap: "0.75rem" }}>
          <h1>Change Room</h1>
          <span className="badge">
            <span className={`dot ${view.paused ? "dot-warn" : view.workflow === "COMPLETE" ? "dot-ok" : "dot-info"}`} />
            {view.paused ? "PAUSED — " : ""}
            {view.statusLabel} ({view.workflow})
          </span>
        </div>
        <span className="text-faint mono" style={{ fontSize: 12 }}>
          shared human + AI operational control
        </span>
      </header>

      {error && (
        <div
          role="alert"
          className="empty text-danger"
          style={{ marginBottom: "0.75rem", textAlign: "left" }}
        >
          {error}
        </div>
      )}

      <div className="statusbar" style={{ marginBottom: "1rem" }}>
        <span className="text-dim" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Controls
        </span>
        {start}
        <span className="rail">
          {available.map((a) => (
            <button
              key={a.id}
              className={`button${a.danger ? " button-danger" : ""}${a.id === "approve" ? " button-primary" : ""}`}
              disabled={busy !== null}
              onClick={() => run(a.id, a.body?.(view))}
            >
              {busy === a.id ? "…" : a.label}
            </button>
          ))}
        </span>
      </div>

      {flash && (
        <div role="status" className="text-info mono" style={{ marginBottom: "0.75rem", fontSize: 12 }}>
          {flash}
        </div>
      )}

      <div className="stack">
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
