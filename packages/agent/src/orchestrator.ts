/**
 * Agent orchestrator (Architecture.md §3).
 *
 * Ties the agent's reasoning flow together: intent -> observation -> evidence
 * -> hypotheses -> plans -> simulation. It holds NO state-changing authority;
 * it only reasons over the observable world and requests capabilities. The
 * orchestrator is deliberately stateless about ground truth — it never sees or
 * stores the hidden cause.
 */

import type { AgentView } from "@change-room/scenarios";
import type { IntentContract, Hypothesis, Plan } from "@change-room/domain";
import { parseIntent } from "./intent.js";
import { investigate, type InvestigationResult } from "./investigation.js";
import { formHypotheses } from "./hypotheses.js";
import { candidatesFor, buildPlans, type PlanCandidate } from "./planning.js";
import { simulatePlan, type SimulatedPlan } from "./simulation.js";
import type { AgentModel } from "./model/index.js";
import type { WorldSimulator } from "@change-room/simulator";

export interface AgentContext {
  /** Simulator or orchestrator exposing `predict` only (no mutation). */
  sim: { predict: WorldSimulator["predict"] };
  currentStateVersion: () => number;
  /** Optional LLM reasoning advisor. It only narrates/explains; it never
   *  decides, gates, or mutates. Absent or failing => deterministic narrative. */
  model?: AgentModel;
}

/** Advisory narrative produced by the (optional) reasoning advisor. This is a
 *  reasoning-layer observation ONLY — it holds no authority and never gates. */
export interface AgentAdvisory {
  assessment: string;
  planRationales: Record<string, string>;
  provider: string;
  model: string;
  isMock: boolean;
}

export interface AgentReasoningResult {
  contract?: IntentContract;
  investigation?: InvestigationResult;
  hypotheses: Hypothesis[];
  candidates: PlanCandidate[];
  plans: Plan[];
  simulations: SimulatedPlan[];
  topHypothesis?: Hypothesis;
  /** Best-effort LLM advisory narrative (empty until advise() runs). */
  advisory?: AgentAdvisory;
}

export class AgentOrchestrator {
  private result: AgentReasoningResult = { hypotheses: [], candidates: [], plans: [], simulations: [] };

  constructor(private readonly ctx: AgentContext) {}

  /** Step 1: interpret the human's goal into an intent contract. */
  setIntent(goal: string): IntentContract {
    const contract = parseIntent(goal);
    this.result.contract = contract;
    return contract;
  }

  /** Step 2: investigate the observable view into structured evidence. */
  investigate(view: AgentView): InvestigationResult {
    const res = investigate(view, this.ctx.currentStateVersion());
    this.result.investigation = res;
    return res;
  }

  /** Step 3: form ranked hypotheses from the evidence. */
  hypothesize(): Hypothesis[] {
    const inv = this.result.investigation;
    if (!inv) throw new Error("investigate() must run before hypothesize()");
    const hyps = formHypotheses({ evidence: inv.evidence, observation: inv.observation });
    this.result.hypotheses = hyps;
    this.result.topHypothesis = hyps[0];
    return hyps;
  }

  /** Step 4: generate candidate plans from the top hypothesis. */
  generatePlans(): { candidates: PlanCandidate[]; plans: Plan[] } {
    const contract = this.result.contract;
    const top = this.result.topHypothesis;
    if (!contract) throw new Error("setIntent() must run before generatePlans()");
    if (!top) this.hypothesize();

    const candidates = candidatesFor(this.result.topHypothesis!, contract, this.ctx.currentStateVersion());
    const plans = buildPlans(candidates, this.result.topHypothesis!, this.ctx.currentStateVersion());
    this.result.candidates = candidates;
    this.result.plans = plans;
    return { candidates, plans };
  }

  /** Step 5: simulate every plan on an isolated prediction branch. */
  simulate(): SimulatedPlan[] {
    if (this.result.plans.length === 0) this.generatePlans();
    const simulations = this.result.plans.flatMap((p) => simulatePlan(this.ctx.sim as WorldSimulator, p));
    this.result.simulations = simulations;
    return simulations;
  }

  /** Full reasoning pipeline over one observation, returning everything. */
  reason(goal: string, view: AgentView): AgentReasoningResult {
    this.setIntent(goal);
    this.investigate(view);
    this.hypothesize();
    this.generatePlans();
    this.simulate();
    return this.result;
  }

  /** Reasoning-advisor pass (Phase 6 §LLM). Runs AFTER the deterministic
   *  pipeline and only attaches explanatory narrative to the result. It never
   *  gates, plans on the agent's behalf, or mutates state. Best-effort: if no
   *  model is configured or the provider fails, a deterministic narrative is
   *  used so the control loop is never blocked. */
  async advise(view: AgentView, goal?: string): Promise<AgentAdvisory> {
    const res = this.result;
    const model = this.ctx.model;
    const prebuilt: AgentAdvisory = {
      assessment: this.defaultAssessment(goal, view, res),
      planRationales: Object.fromEntries(res.plans.map((p) => [p.id, this.defaultRationale(p, res)])),
      provider: "deterministic",
      model: "change-room-rules",
      isMock: true,
    };
    if (!model) return prebuilt;

    const prompt = this.buildAdvicePrompt(goal, view, res);
    try {
      const out = await model.complete(
        [
          {
            role: "system",
            content:
              "You are the Change Room's reasoning advisor for a real Medusa e-commerce stack. " +
              "You only explain and summarize the agent's already authoritative, deterministic analysis " +
              "and known real observations. You do NOT make decisions, grant permissions, or propose to " +
              "mutate state. If evidence is thin, say so. Be concise, concrete, and grounded in the data provided.",
          },
          { role: "user", content: prompt },
        ],
        { responseFormat: "json", temperature: 0.2, maxTokens: 700, timeoutMs: 20000 }
      );
      const parsed = parseAdviceJson(out.text);
      return {
        assessment: parsed.assessment || prebuilt.assessment,
        planRationales: parsed.planRationales && Object.keys(parsed.planRationales).length > 0 ? parsed.planRationales : prebuilt.planRationales,
        provider: out.provider,
        model: out.model,
        isMock: out.isMock,
      };
    } catch {
      return prebuilt;
    }
  }

  private defaultAssessment(goal: string | undefined, view: AgentView, res: AgentReasoningResult): string {
    const k = view.kpis;
    const top = res.topHypothesis;
    const degraded = metricArray(view).filter((m) => m.degraded).map((m) => m.componentId).join(", ");
    let s = `Goal: ${goal ?? "restore system health"}. System health: ${k.systemHealth}. `;
    s += `Checkout latency ${k.checkoutLatencyMs}ms, error rate ${k.checkoutErrorRate}%, success ${k.checkoutSuccessRate}%. `;
    if (k.cacheHitRateEstimate !== undefined) s += `Cache hit-rate estimate ${k.cacheHitRateEstimate}%. `;
    s += `Degraded components: ${degraded || "none"}. `;
    s += top ? `Leading hypothesis: ${top.cause} (confidence ${Math.round(top.confidence * 100)}%). ` : "No hypothesis supported yet. ";
    s += res.plans.length > 0 ? `${res.plans.length} plan(s) considered.` : "No plans generated yet.";
    return s;
  }

  private defaultRationale(plan: Plan, res: AgentReasoningResult): string {
    const top = res.topHypothesis;
    const action = plan.actions[0]?.type ?? "observe";
    let s = plan.objective;
    if (top) s += ` Targets ${top.cause}.`;
    s += ` Executes "${action}". Confidence ${Math.round(plan.confidence * 100)}%, risk ${plan.risk.overall}, reversibility ${plan.reversibility}.`;
    if (plan.assumptions?.length) s += ` Assumes: ${plan.assumptions.join("; ")}.`;
    return s;
  }

  private buildAdvicePrompt(goal: string | undefined, view: AgentView, res: AgentReasoningResult): string {
    const k = view.kpis;
    const metrics = metricArray(view)
      .map((m) => `${m.componentId}: util=${m.utilization}% lat=${m.latencyMs}ms err=${m.errorRate}% deg=${m.degraded}`)
      .join("\n");
    const hyps = res.hypotheses
      .slice(0, 4)
      .map((h) => `- ${h.cause} (conf ${Math.round(h.confidence * 100)}%, ${h.status})\n  supporting: ${h.supporting.join(", ") || "none"}`)
      .join("\n");
    const plans = res.plans
      .map((p) => `- plan ${p.id} "${p.name}": ${p.actions.map((a) => a.type).join(" -> ")} (conf ${Math.round(p.confidence * 100)}%, risk ${p.risk.overall}, ${p.reversibility})`)
      .join("\n");
    return [
      `GOAL: ${goal ?? "restore system health"}`,
      `SYSTEM HEALTH: ${k.systemHealth}; checkout latency ${k.checkoutLatencyMs}ms, error ${k.checkoutErrorRate}%, success ${k.checkoutSuccessRate}%, cacheHitRateEstimate ${k.cacheHitRateEstimate}%`,
      "METRICS:",
      metrics || "(none)",
      "TOP HYPOTHESES:",
      hyps || "(none)",
      "PLANS:",
      plans || "(none)",
      "",
      "Return STRICT JSON with exactly two keys:",
      '  "assessment": a 2-4 sentence plain-language situation assessment grounded only in the above, naming the likely cause and the tradeoffs of the candidate remediations.',
      '  "planRationales": an object mapping each plan id (e.g. "plan_02") to a 1-2 sentence rationale for the human - why that action, what recovery it targets, and its key caveat.',
      "Do not invent metrics or claim knowledge outside the data provided.",
    ].join("\n");
  }

  get last(): AgentReasoningResult {
    return this.result;
  }
}

/** Robust best-effort parser for the JSON advisory returned by the model. */
function parseAdviceJson(text: string): { assessment?: string; planRationales?: Record<string, string> } {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    const obj = JSON.parse(cleaned);
    return {
      assessment: typeof obj.assessment === "string" ? obj.assessment : undefined,
      planRationales: typeof obj.planRationales === "object" && obj.planRationales !== null ? obj.planRationales : undefined,
    };
  } catch {
    // Not valid JSON; treat the whole response as a freeform assessment.
    return { assessment: cleaned || undefined, planRationales: undefined };
  }
}

/** AgentView.metrics is `Array<Record<string, unknown>>`; cast to a readable
 *  component shape for the advisory prompt (no schema change). */
interface MetricShape {
  componentId: string;
  utilization: number;
  latencyMs: number;
  errorRate: number;
  degraded: boolean;
}
function metricArray(view: AgentView): MetricShape[] {
  const raw = view.metrics ?? [];
  return raw.map((m) => {
    const r = m as Record<string, unknown>;
    return {
      componentId: String(r.componentId ?? "unknown"),
      utilization: Number(r.utilization ?? 0),
      latencyMs: Number(r.latencyMs ?? 0),
      errorRate: Number(r.errorRate ?? 0),
      degraded: r.degraded === true,
    };
  });
}
