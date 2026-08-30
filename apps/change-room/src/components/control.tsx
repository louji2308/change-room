"use client";

import type { View } from "@/lib/api";

/** Phase 4.8 + 5 — Approval & Change Control result (gate decision). */
export function ApprovalPanel({ view }: { view: View }) {
  const g = view.gate;
  const phase = view.phase;
  const selected = view.plans?.find((p: any) => p.id === view.selectedPlanId);
  return (
    <section className="panel" aria-label="Approval and change control">
      <h3>Change Control</h3>
      {!g ? (
        <div className="empty">Select a plan and prepare the change to evaluate it through the control gate.</div>
      ) : (
        <dl className="kv">
          <dt>Stage</dt>
          <dd className="mono">{g.stage}</dd>
          <dt>Allowed</dt>
          <dd>
            <span className={`badge ${g.allowed ? "badge" : ""}`}>
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
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <span className="dot dot-warn" />
          <span>Change is waiting for human approval — use the controls below.</span>
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
    <section className="panel" aria-label="Verification">
      <h3>Prediction vs Reality</h3>
      {!active ? (
        <div className="empty">No verification yet — execute a change to compare prediction against outcome.</div>
      ) : (
        <>
          <div className="spread" style={{ marginBottom: "0.5rem" }}>
            <span className={`row text-xl text-${verdictTone(active.verdict)}`}>{active.verdict}</span>
            <span className="text-dim mono">{active.summary}</span>
          </div>
          {active.deviations?.length > 0 && (
            <table className="table">
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
    <section className="panel" aria-label="Flight recorder">
      <h3>Flight Recorder</h3>
      <div className="chips" style={{ marginBottom: "0.75rem" }}>
        <span className="badge">{count} events</span>
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
        <div className="mono" style={{ maxHeight: 340, overflow: "auto" }}>
          {replay.map((e, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: "0.5rem",
                padding: "0.2rem 0",
                borderBottom: "1px solid var(--border)",
                fontSize: 12,
              }}
            >
              <span className="text-faint">#{e.seq}</span>
              <span className="text-info">{e.actor}</span>
              <span className="text-warn">{e.type}</span>
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

function num(v: unknown): string {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function verdictTone(v?: string) {
  return v === "HEALTHY" ? "ok" : v === "REGRESSION" ? "danger" : v === "DEGRADED" ? "warn" : "dim";
}
