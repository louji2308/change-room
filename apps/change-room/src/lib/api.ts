/** Client-side helper for talking to the Change Room API. */

export type View = {
  workflow: string;
  statusLabel: string;
  phase: { name: string; requestId?: string; verdict?: string };
  scenario: { scenarioId: string; startedAt: number; steps: number } | null;
  health: string;
  kpis: Record<string, number | string>;
  metrics: any[];
  intent: any;
  investigation: any;
  hypotheses: any[];
  plans: any[];
  simulations: any[];
  topHypothesis: any;
  selectedPlanId: string | null;
  gate: any;
  verification: any;
  flight: any;
  blind: boolean;
  stateVersion: number;
  delegation: any;
  paused: boolean;
  humanMutations: any[];
};

export type SessionResponse = {
  ok: boolean;
  error?: string;
  code?: string;
  view?: View;
  result?: any;
  gate?: any;
  execution?: any;
  verification?: any;
  scenarios?: any[];
};

export async function api(action: string, body?: Record<string, unknown>): Promise<SessionResponse> {
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  return (await res.json()) as SessionResponse;
}

export async function getState(): Promise<View> {
  const res = await fetch("/api/session", { cache: "no-store" });
  const json = await res.json();
  return json.view as View;
}
