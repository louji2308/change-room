"use client";

import { useState } from "react";
import type { View } from "@/lib/api";
import { api } from "@/lib/api";

/** Phase 4.8 + 5 — Approval & Change Control result (gate decision). */
export function ApprovalPanel({ view }: { view: View }) {
  const g = view.gate;
  const phase = view.phase;
  const selected = view.plans?.find((p: any) => p.id === view.selectedPlanId);
  return (
    <section className="panel peach" aria-label="Approval and change control">
      <h3>Change Control</h3>
      {!g ? (
        <div className="empty">Select a plan and prepare the change to evaluate it through the control gate.</div>
      ) : (
        <dl className="kv">
          <dt>Stage</dt>
          <dd className="mono">{g.stage}</dd>
          <dt>Allowed</dt>
          <dd>
            <span className={`badge ${g.allowed ? "green" : "red"}`}>
              <span className={`dot ${g.allowed ? "dot-ok" : "dot-danger"}`} />
              {g.allowed ? "allowed" : "blocked"}
            </span>
          </dd>
          <dt>Approval required</dt>
          <dd>{g.approvalRequired ? "yes — human sign-off" : "no"}</dd>
          <dt>Reason</dt>
          <dd>{g.reason}</dd>
          <dt>Risk (overall)</dt>
          <dd className="text-warn">{g.risk?.overall ?? "—"}</dd>
        </dl>
      )}
      {phase.name === "awaiting" && (
        <div className="row" style={{ marginTop: "1rem", padding: "0.75rem 1rem", background: "var(--yellow-soft)", borderRadius: "var(--r-sm)", border: "1px solid var(--yellow)" }}>
          <span className="dot dot-warn" />
          <span style={{ color: "var(--yellow)" }}>Change is waiting for human approval — use the controls below.</span>
        </div>
      )}
      {selected && (
        <div className="text-dim" style={{ marginTop: "0.75rem", fontSize: 12 }}>
          In review: <span className="mono">{selected.name}</span> ({selected.actions?.map((a: any) => a.type).join(", ")})
        </div>
      )}
    </section>
  );
}

/** Phase 9 + 11 — Prediction vs Reality and flight timeline. */
export function VerificationPanel({ view }: { view: View }) {
  const v: any = view.verification;
  const comparisons: any[] = v?.comparisons ?? [];
  const active = comparisons[0];
  return (
    <section className="panel lilac" aria-label="Verification">
      <h3>Prediction vs Reality</h3>
      {!active ? (
        <div className="empty">No verification yet — execute a change to compare prediction against outcome.</div>
      ) : (
        <>
          <div className="spread" style={{ marginBottom: "0.75rem", alignItems: "baseline" }}>
            <span className={`row text-xl text-${verdictTone(active.verdict)}`}>{active.verdict}</span>
            <span className="text-dim mono">{active.summary}</span>
          </div>
          {active.deviations?.length > 0 && (
            <div className="table-wrap">
              <table className="table" aria-label="Verification deviations">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Predicted</th>
                    <th>Actual</th>
                    <th>Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {active.deviations.map((d: any, i: number) => (
                    <tr key={i}>
                      <td className="mono">{d.metric}</td>
                      <td>{num(d.predicted)}</td>
                      <td>{num(d.actual)}</td>
                      <td className={verdictTone(d.ratio > 1 ? "REGRESSION" : "HEALTHY")}>{num(d.delta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Phase 11.3 — Flight recorder replay timeline. */
export function TimelinePanel({ view }: { view: View }) {
  const flight: any = view.flight;
  const count: number = flight?.count ?? 0;
  const byType: Record<string, number> = flight?.byType ?? {};
  const replay: any[] = flight?.events ?? [];
  return (
    <section className="panel yellow" aria-label="Flight recorder">
      <h3>Flight Recorder</h3>
      <div className="chips" style={{ marginBottom: "1rem" }}>
        <span className="badge lilac">{count} events</span>
        {Object.entries(byType)
          .slice(0, 6)
          .map(([k, n]) => (
            <span className="badge" key={k}>
              {k}: {n}
            </span>
          ))}
      </div>
      {replay.length === 0 ? (
        <div className="empty">No recorded events yet — every workflow step is recorded here.</div>
      ) : (
        <div className="mono" style={{ maxHeight: 360, overflow: "auto", padding: "0 0.25rem" }}>
          {replay.map((e, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "0.75rem",
                padding: "0.45rem 0",
                borderBottom: "1px solid var(--border)",
                fontSize: 12.5,
              }}
            >
              <span className="text-faint" style={{ minWidth: 36 }}>#{e.seq}</span>
              <span className="text-info" style={{ minWidth: 70 }}>{e.actor}</span>
              <span className="text-warn" style={{ minWidth: 90 }}>{e.type}</span>
              <span className="text-dim" style={{ flex: 1 }}>
                {e.resultSummary ?? ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Phase 12 — Bounded delegation + human takeover controls. */
export function DelegationPanel({ view }: { view: View }) {
  const [ceiling, setCeiling] = useState<string>("medium");
  const [durationMs, setDurationMs] = useState<string>("600000");
  const [reversibleOnly, setReversibleOnly] = useState<boolean>(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async (action: string, body?: Record<string, unknown>) => {
    setBusy(action);
    setMsg(null);
    const res = await api(action, body);
    if (res.ok) setMsg(`${action} ok`);
    else setMsg(res.error ?? `${action} failed`);
    window.location.reload();
    setBusy(null);
  };

  const d: any = view.delegation;
  return (
    <section className="panel pink" aria-label="Delegation and human takeover">
      <h3>Delegation &amp; Takeover</h3>

      <div className="chips" style={{ marginBottom: "1rem" }}>
        <span className={`badge ${view.paused ? "yellow" : "green"}`}>
          <span className={`dot ${view.paused ? "dot-warn" : "dot-ok"}`} />
          {view.paused ? "AGENT PAUSED" : "agent active"}
        </span>
        <span className="badge blue">state v{view.stateVersion}</span>
        <span className="badge teal">{d ? `delegated: ${d.riskCeiling} / ${d.scope?.length ?? 0} resources` : "no delegation"}</span>
      </div>

      {d && (
        <dl className="kv">
          <dt>Risk ceiling</dt>
          <dd>{d.riskCeiling}</dd>
          <dt>Scope</dt>
          <dd className="mono">{d.scope?.join(", ") ?? "—"}</dd>
          <dt>Reversible only</dt>
          <dd>{d.reversibleOnly ? "yes" : "no"}</dd>
          <dt>Approval still required</dt>
          <dd>{d.approvalStillRequired ? "yes" : "no"}</dd>
          <dt>Expires</dt>
          <dd className="mono">{new Date(d.expiresAt).toLocaleTimeString()}</dd>
        </dl>
      )}

      <div className="stack" style={{ marginTop: "1rem" }}>
        <div className="row" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
          <label className="row" style={{ gap: "0.4rem" }} htmlFor="delegation-ceiling">
            <span className="text-faint" style={{ fontSize: 12 }}>ceiling</span>
            <select id="delegation-ceiling" name="risk-ceiling" className="button" value={ceiling} onChange={(e) => setCeiling(e.target.value)} aria-label="Risk ceiling">
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </label>
          <label className="row" style={{ gap: "0.4rem" }} htmlFor="delegation-duration">
            <span className="text-faint" style={{ fontSize: 12 }}>duration (ms)</span>
            <input
              id="delegation-duration"
              name="delegation-duration"
              className="button"
              style={{ width: 96 }}
              type="number"
              value={durationMs}
              onChange={(e) => setDurationMs(e.target.value)}
              aria-label="Delegation duration milliseconds"
            />
          </label>
          <label className="row" style={{ gap: "0.4rem" }} htmlFor="delegation-reversible">
            <input id="delegation-reversible" name="reversible-only" type="checkbox" checked={reversibleOnly} onChange={(e) => setReversibleOnly(e.target.checked)} />
            <span style={{ fontSize: 13 }}>reversible only</span>
          </label>
        </div>
        <div className="row" style={{ gap: "0.75rem" }}>
          <button
            className="button"
            disabled={busy !== null}
            onClick={() => run("delegate", { riskCeiling: ceiling, durationMs: Number(durationMs), reversibleOnly })}
            aria-busy={busy === "delegate" || undefined}
          >
            {busy === "delegate" ? <><span className="spinner" aria-hidden="true" />Working…</> : "Grant delegation"}
          </button>
          <button className="button button-danger" disabled={busy !== null || !d} onClick={() => run("revoke_delegation")} aria-busy={busy === "revoke_delegation" || undefined}>
            {busy === "revoke_delegation" ? <><span className="spinner" aria-hidden="true" />Working…</> : "Revoke"}
          </button>
          {view.paused ? (
            <button className="button button-primary" disabled={busy !== null} onClick={() => run("resume")} aria-busy={busy === "resume" || undefined}>
              {busy === "resume" ? <><span className="spinner" aria-hidden="true" />Working…</> : "Resume agent"}
            </button>
          ) : (
            <button className="button" disabled={busy !== null} onClick={() => run("pause")} aria-busy={busy === "pause" || undefined}>
              {busy === "pause" ? <><span className="spinner" aria-hidden="true" />Working…</> : "Pause agent"}
            </button>
          )}
        </div>
        <div className="row" style={{ gap: "0.75rem", marginTop: "0.25rem" }}>
          <button className="button button-danger" disabled={busy !== null} onClick={() => run("takeover", { actionType: "restore_configuration", note: "human applied restore_configuration manually" })} aria-busy={busy === "takeover" || undefined}>
            {busy === "takeover" ? <><span className="spinner" aria-hidden="true" />Working…</> : "Human takeover (restore config)"}
          </button>
          <button className="button button-danger" disabled={busy !== null} onClick={() => run("takeover", { actionType: "scale_database", note: "human scaled database manually" })} aria-busy={busy === "takeover" || undefined}>
            {busy === "takeover" ? <><span className="spinner" aria-hidden="true" />Working…</> : "Human takeover (scale DB)"}
          </button>
        </div>
      </div>

      {msg && (
        <div role="status" className="alert alert-flash" style={{ marginTop: "0.75rem" }}>
          <span className="alert-icon" aria-hidden="true">&#10003;</span>
          <span className="mono" style={{ fontSize: 12 }}>{msg}</span>
        </div>
      )}
      {view.humanMutations?.length > 0 && (
        <div role="alert" className="alert alert-error" style={{ marginTop: "0.75rem" }}>
          <span className="alert-icon" aria-hidden="true">!</span>
          <span className="mono" style={{ fontSize: 12 }}>
            {view.humanMutations.length} human mutation(s) recorded — current plans may be stale.
          </span>
        </div>
      )}
    </section>
  );
}

function num(v: unknown): string {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function verdictTone(v?: string): string {
  return v === "HEALTHY" ? "ok" : v === "REGRESSION" ? "danger" : v === "DEGRADED" ? "warn" : "dim";
}
