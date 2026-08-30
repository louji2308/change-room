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
import type { WorldSimulator } from "@change-room/simulator";

export interface AgentContext {
  /** Simulator or orchestrator exposing `predict` only (no mutation). */
  sim: { predict: WorldSimulator["predict"] };
  currentStateVersion: () => number;
}

export interface AgentReasoningResult {
  contract?: IntentContract;
  investigation?: InvestigationResult;
  hypotheses: Hypothesis[];
  candidates: PlanCandidate[];
  plans: Plan[];
  simulations: SimulatedPlan[];
  topHypothesis?: Hypothesis;
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

  get last(): AgentReasoningResult {
    return this.result;
  }
}
