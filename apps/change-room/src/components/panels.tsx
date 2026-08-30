"use client";

import type { View } from "@/lib/api";

function HealthDot({ health }: { health: string }) {
  const cls =
    health === "healthy" ? "dot-ok" : health === "degraded" ? "dot-warn" : health === "down" ? "dot-danger" : "dot-dim";
  return <span aria-hidden className={`dot ${cls}`} />;
}

/** Phase 4.2 — System overview (health, KPIs, component metrics). */
export function SystemPanel({ view }: { view: View }) {
  const k = view.kpis ?? {};
  const metrics = view.metrics ?? [];
  return (
    <section className="panel" aria-label="System overview">
      <h3>System</h3>
      <div className="spread" style={{ marginBottom: "0.75rem" }}>
        <span className="row" style={{ fontSize: "1.25rem" }}>
          <HealthDot health={view.health} />
          <strong>{view.health}</strong>
        </span>
        <span className="badge">
          <span className={`dot ${view.blind ? "dot-info" : "dot-dim"}`} />
          blind agent view {view.blind ? "ON" : "OFF"}
        </span>
      </div>
      <dl className="kv" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", marginBottom: "0.75rem" }}>
        <dd>
          <span className="text-faint">checkout</span>
          <div style={{ fontSize: "1.05rem", fontWeight: 600 }}>
            {fmt(k.checkoutLatencyMs, "ms")}{" "}
            <span className={`text-${healthTone(Number(k.checkoutErrorRate))}`}>{fmt(k.checkoutErrorRate, "%")} err</span>
          </div>
        </dd>
        <dd>
          <span className="text-faint">throughput</span>
          <div style={{ fontSize: "1.05rem", fontWeight: 600 }}>{fmt(k.ordersThroughputPerSec, "/s")}</div>
        </dd>
        <dd>
          <span className="text-faint">cache hit</span>
          <div style={{ fontSize: "1.05rem", fontWeight: 600 }}>{fmt(k.cacheHitRateEstimate, "%")}</div>
        </dd>
      </dl>
      {metrics.length === 0 ? (
        <div className="empty">No metrics yet — start a scenario to observe the system.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Component</th>
              <th>Utilization</th>
              <th>Latency</th>
              <th>Error</th>
              <th>Queue</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.componentId}>
                <td>
                  <span className="row">
                    <span className={`dot ${m.degraded ? "dot-warn" : "dot-ok"}`} />
                    {m.componentId}
                  </span>
                </td>
                <td>
                  <span className="row">
                    <span className="bar-track">
                      <span
                        className="bar-fill"
                        style={{ width: `${Math.min(100, Number(m.utilization))}%`, background: barColor(m.utilization) }}
                      />
                    </span>
                    {Math.round(Number(m.utilization))}%
                  </span>
                </td>
                <td>{fmt(m.latencyMs, "ms")}</td>
                <td className={healthTone(Number(m.errorRate)) === "ok" ? "" : "text-danger"}>{fmt(m.errorRate, "%")}</td>
                <td>{Number(m.queueDepth) ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Phase 4.3 — Incident workspace. */
export function IncidentPanel({ view }: { view: View }) {
  const hyp = view.topHypothesis;
  return (
    <section className="panel" aria-label="Incident">
      <h3>Incident</h3>
      <dl className="kv">
        <dt>Status</dt>
        <dd>
          <span className="row">
            <HealthDot health={view.health} />
            <strong>{view.statusLabel}</strong>
            <span className="text-dim">({view.workflow})</span>
          </span>
        </dd>
        <dt>Scenario</dt>
        <dd>{view.scenario ? view.scenario.scenarioId : "—"}</dd>
        <dt>Lead hypothesis</dt>
        <dd>{hyp ? hyp.cause : "none yet"}</dd>
        <dt>Assurance</dt>
        <dd>{hyp ? `${Math.round((hyp.confidence ?? 0) * 100)}%` : "—"}</dd>
      </dl>
    </section>
  );
}

/** Phase 4.4 — Evidence panel. */
export function EvidencePanel({ view }: { view: View }) {
  const inv: any = view.investigation;
  const evidence: any[] = inv?.evidence ?? [];
  return (
    <section className="panel" aria-label="Evidence">
      <h3>Evidence</h3>
      {evidence.length === 0 ? (
        <div className="empty">No evidence collected. Run the agent&apos;s investigation to gather structured signals.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Signal</th>
              <th>Value</th>
              <th>Source</th>
              <th>Relevance</th>
            </tr>
          </thead>
          <tbody>
            {evidence.map((e, i) => (
              <tr key={i}>
                <td className="mono">{e.metric ?? e.componentId}</td>
                <td>{e.value != null ? String(e.value) : "—"}</td>
                <td className="text-dim">{e.source ?? "—"}</td>
                <td>{e.relevance != null ? `${Math.round(Number(e.relevance) * 100)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Phase 4.5 — Hypothesis panel. */
export function HypothesesPanel({ view }: { view: View }) {
  const hyps: any[] = view.hypotheses ?? [];
  return (
    <section className="panel" aria-label="Hypotheses">
      <h3>Hypotheses</h3>
      {hyps.length === 0 ? (
        <div className="empty">No hypotheses yet.</div>
      ) : (
        <ol style={{ margin: 0, paddingLeft: "1.1rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {hyps.map((h, i) => {
            const isTop = i === 0 && h.id === view.topHypothesis?.id;
            return (
              <li key={h.id ?? i}>
                <div className="spread" style={{ alignItems: "baseline" }}>
                  <span className="row">
                    <span className={`dot ${isTop ? "dot-warn" : "dot-dim"}`} />
                    <strong>{h.cause ?? h.title ?? "hypothesis"}</strong>
                  </span>
                  <span className="badge">{(h.confidence ?? 0) * 100}%</span>
                </div>
                {(h.supporting?.length ?? 0) > 0 && (
                  <div className="text-dim" style={{ marginTop: "0.25rem", fontSize: "12.5px" }}>
                    supports: {h.supporting.map((s: any) => s.metric ?? s).join(", ")}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** Phase 4.6 + 4.7 — Plan comparison and simulation. */
export function PlansPanel({ view }: { view: View }) {
  const plans: any[] = view.plans ?? [];
  const selectedId = view.selectedPlanId;
  return (
    <section className="panel" aria-label="Plans">
      <h3>Plans</h3>
      {plans.length === 0 ? (
        <div className="empty">No plans generated. Run the agent&apos;s reasoning to produce candidate remediations.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Plan</th>
              <th>Actions</th>
              <th>Risk</th>
              <th>Reversibility</th>
              <th>Blast</th>
              <th>Assurance</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} style={p.id === selectedId ? { background: "rgba(108,192,255,0.06)" } : undefined}>
                <td>
                  <strong>{p.name}</strong>
                  <div className="text-faint mono" style={{ fontSize: 11 }}>
                    {p.objective}
                  </div>
                </td>
                <td className="mono">{p.actions?.map((a: any) => a.type).join(", ") || "—"}</td>
                <td>
                  <span className={`badge text-${riskTone(p.risk?.overall)}`}>{p.risk?.overall ?? "—"}</span>
                </td>
                <td className="text-dim" style={{ fontSize: 12 }}>
                  {p.reversibility}
                </td>
                <td className="text-dim">{p.blastRadius}</td>
                <td>{Math.round((p.confidence ?? 0) * 100)}%</td>
                <td>
                  {p.id === selectedId ? <span className="badge">selected</span> : <span className="text-faint">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Phase 4.7 — Simulation outcomes (predicted KPIs per plan action). */
export function SimulationPanel({ view }: { view: View }) {
  const sims: any[] = view.simulations ?? [];
  return (
    <section className="panel" aria-label="Simulation">
      <h3>Simulation (predicted)</h3>
      {sims.length === 0 ? (
        <div className="empty">No simulated branches yet.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Plan</th>
              <th>Action</th>
              <th>Predicted checkout latency</th>
              <th>Predicted health</th>
              <th>Ok</th>
            </tr>
          </thead>
          <tbody>
            {sims.map((s, i) => (
              <tr key={i}>
                <td>{s.plan?.name ?? "—"}</td>
                <td className="mono">{s.actionType}</td>
                <td>
                  {s.predictedKpis?.checkoutLatencyMs != null ? `${s.predictedKpis.checkoutLatencyMs} ms` : "—"}
                </td>
                <td>{String(s.prediction?.kpis?.systemHealth ?? "—")}</td>
                <td>{s.error ? <span className="text-danger">error</span> : "✓"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function riskTone(r?: string) {
  return r === "high" ? "danger" : r === "medium" ? "warn" : "ok";
}

function healthTone(v: number): "ok" | "danger" {
  return v > 20 ? "danger" : "ok";
}

function barColor(v: unknown): string {
  const n = Number(v);
  if (n >= 90) return "var(--danger)";
  if (n >= 70) return "var(--warn)";
  return "var(--ok)";
}

function fmt(v: unknown, unit?: string): string {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  const rounded = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return unit ? `${rounded}${unit}` : rounded;
}
