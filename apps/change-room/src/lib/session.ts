/**
 * Change Room — server-side operational session (Phases 4, 5, 6, 8, 9, 11).
 *
 * The single host that connects the scenario runtime, the change-control
 * boundary, the reasoning agent, the prediction-vs-reality engine and the
 * flight recorder behind one workflow state machine. The app keeps exactly one
 * live session (in-memory) for the sandbox demo.
 *
 * Blindness guarantee: this module never exposes `groundTruth()` to any agent
 * surface and never puts seed/disturbances/cause into an agent-tool response.
 */

import { ScenarioRunner } from "@change-room/scenarios";
import type { ActionType, BusinessKpis, PredictionResult } from "@change-room/simulator";
import { metricsOf } from "@change-room/verification";
import { AgentOrchestrator } from "@change-room/agent";
import type { IntentContract, Hypothesis, Plan, ToolName, WorkflowState } from "@change-room/domain";
import {
  evaluateGate,
  PolicyEngine,
  type DelegationGrant,
  type GateDecision,
  type PermissionContext,
  type StateMutation,
  type ActorType,
} from "@change-room/control";
import { FlightRecorder } from "@change-room/flight-recorder";
import { PredictionVsReality } from "@change-room/verification";

const AGENT_LEVEL = "L3" as const; // execute-with-approval: consequential changes need a human.

/** Default operational policy for the sandbox. */
function defaultPolicy(): PolicyEngine {
  return new PolicyEngine({
    rules: [
      { id: "db-schema", forbidResources: ["schema"], forbidActionTypes: ["change_configuration"], reason: "database schema must not be changed at runtime" },
      { id: "prod-config", requireApprovalFor: ["change_configuration", "scale_database", "rollback_deployment"], reason: "production configuration changes require human approval" },
      { id: "irreversible", forbidIrreversible: true, reason: "irreversible operations are forbidden" },
    ],
  });
}

type SessionPhase =
  | { name: "idle" }
  | { name: "setup"; scenarioId: string }
  | { name: "incident"; scenarioId: string }
  | { name: "reasoned" }
  | { name: "awaiting"; requestId: string }
  | { name: "approved" }
  | { name: "executed" }
  | { name: "verified"; verdict: string }
  | { name: "deviated"; verdict?: string }
  | { name: "recovered" }
  | { name: "complete" };

export interface PublicView {
  workflow: WorkflowState;
  statusLabel: string;
  phase: SessionPhase;
  scenario: { scenarioId: string; startedAt: number; steps: number } | null;
  health: string;
  kpis: BusinessKpis;
  metrics: unknown[];
  intent: IntentContract | null;
  investigation: unknown;
  hypotheses: Hypothesis[];
  plans: Plan[];
  simulations: unknown[];
  topHypothesis: Hypothesis | null;
  selectedPlanId: string | null;
  gate: GateDecision | null;
  verification: ReturnType<PredictionVsReality["summary"]>;
  flight: ReturnType<FlightRecorder["summary"]> & { steps: ReturnType<FlightRecorder["replay"]>["steps"] };
  blind: boolean;
  /** Current live state version (advances on human takeover / execution). */
  stateVersion: number;
  /** Bounded delegation currently in force, if any. */
  delegation: DelegationGrant | null;
  /** Whether the agent is currently paused. */
  paused: boolean;
  /** Human-committed mutations since the current plan, for conflict detection. */
  humanMutations: StateMutation[];
}

export class ChangeRoomSession {
  private runner: ScenarioRunner | null = null;
  private orchestrator: AgentOrchestrator | null = null;
  private policy = defaultPolicy();
  private workflow: WorkflowState = "IDLE";
  private permission: PermissionContext = { granted: ["observe", "recommend", "prepare", "execute-with-approval"], level: AGENT_LEVEL };
  private flight = new FlightRecorder();
  private verification = new PredictionVsReality();
  private phase: SessionPhase = { name: "idle" };
  private selectedPlanId: string | null = null;
  private lastGate: GateDecision | null = null;
  private requestCounter = 0;
  /** Live state version; advances whenever the world meaningfully changes. */
  private currentVersion = 0;
  /** Bounded delegation currently in force (Phase 12). */
  private delegation: DelegationGrant | null = null;
  /** Whether the agent is paused (Phase 12.2). */
  private paused = false;
  /** Mutations committed by the human since the current plan (conflict detection). */
  private humanMutations: StateMutation[] = [];

  /** Scenario the sandbox is running (named scenario id), for admin/debug only. */
  private scenarioName: string | null = null;

  reset(): void {
    this.runner = null;
    this.orchestrator = null;
    this.workflow = "IDLE";
    this.phase = { name: "idle" };
    this.selectedPlanId = null;
    this.lastGate = null;
    this.flight = new FlightRecorder();
    this.verification = new PredictionVsReality();
    this.scenarioName = null;
    this.currentVersion = 0;
    this.delegation = null;
    this.paused = false;
    this.humanMutations = [];
  }

  /** Start a scenario (by its stable scenario-database id) and run to baseline. */
  startScenario(scenarioId: string): void {
    const runner = ScenarioRunner.setup(scenarioId);
    runner.start();
    // advance into the incident a little so the agent sees degraded/impact
    runner.settle(20);
    this.runner = runner;
    this.currentVersion = runner.session().startedAt;
    this.delegation = null;
    this.paused = false;
    this.humanMutations = [];
    this.orchestrator = new AgentOrchestrator({ sim: { predict: (a, o) => runner.predict(a, o) }, currentStateVersion: () => this.currentVersion });
    this.scenarioName = scenarioId;
    this.workflow = "CONTRACT_SET";
    this.phase = { name: "incident", scenarioId };
    this.flight.record({ actor: "system", type: "observation", resultSummary: `scenario started; workflow=CONTRACT_SET`, detail: { scenarioId: runner.session().scenarioId } });
  }

  private requireRunner(): ScenarioRunner {
    if (!this.runner) throw Object.assign(new Error("no active scenario"), { code: "NO_SCENARIO" });
    return this.runner;
  }

  /**
   * Run the full agent reasoning pipeline over the current view for a goal.
   * Blind-safe: returns observable evidence, hypotheses, plans and simulated
   * (predicted) outcomes — never ground truth.
   */
  reason(goal: string): ReturnType<AgentOrchestrator["reason"]> {
    const runner = this.requireRunner();
    if (this.paused) throw Object.assign(new Error("agent is paused; cannot reason"), { code: "PAUSED" });
    const view = runner.agentView();
    const result = this.orchestrator!.reason(goal, view);
    this.workflow = result.plans.length > 0 ? "PLAN_READY" : "INVESTIGATING";
    this.phase = { name: "reasoned" };
    this.flight.record({ actor: "agent", type: result.contract ? "intent_contract_set" : "observation", planId: result.plans[0]?.id, inputSummary: goal, resultSummary: `${result.hypotheses.length} hypotheses, ${result.plans.length} plans`, detail: { workflow: this.workflow } });
    return result;
  }

  /** Select a plan as the one to carry forward and mark it SIMULATED. */
  selectPlan(planId: string): void {
    const result = this.orchestrator!.last;
    const plan = result.plans.find((p) => p.id === planId);
    if (!plan) throw new Error(`unknown plan ${planId}`);
    this.selectedPlanId = planId;
    this.workflow = "SIMULATED";
    this.flight.record({ actor: "agent", type: "plan_status_changed", planId, resultSummary: `selected ${plan.name} (risk ${plan.risk.overall})` });
  }

  /**
   * Evaluate the selected plan through the Change Control gate AND record the
   * prediction into the verification store. Returns the gate decision.
   */
  prepareChange(): GateDecision {
    const runner = this.requireRunner();
    if (this.paused) throw Object.assign(new Error("agent is paused; cannot advance the workflow"), { code: "PAUSED" });
    if (!this.selectedPlanId) {
      const top = this.orchestrator!.last.plans[0];
      if (top) this.selectedPlanId = top.id;
    }
    const plan = this.selectedPlan();
    const currentVersion = this.currentVersion;
    const gate = evaluateGate(
      {
        plan,
        currentStateVersion: currentVersion,
        permission: this.permission,
        delegation: this.delegation,
        now: Date.now(),
        mutationsSince: this.humanMutations,
      },
      this.policy
    );
    this.lastGate = gate;

    // Record the prediction (from the last simulation) into verification.
    const sim = this.orchestrator!.last.simulations.find((s) => s.plan.id === plan.id);
    if (sim && sim.prediction) {
      this.verification.recordPrediction({
        planId: plan.id,
        stateVersion: currentVersion,
        predicted: sim.predictedKpis,
        predictedHealth: sim.prediction.kpis.systemHealth,
        assumptions: plan.assumptions,
        timestamp: Date.now(),
      });
    }

    if (gate.allowed) {
      this.workflow = gate.approvalRequired ? "WAITING_FOR_APPROVAL" : "APPROVED";
      this.phase = gate.approvalRequired ? { name: "awaiting", requestId: `req-${++this.requestCounter}` } : { name: "approved" };
    }
    this.flight.record({ actor: "system", type: "policy_checked", planId: plan.id, resultSummary: `${gate.stage}: ${gate.reason} (${gate.approvalRequired ? "approval required" : "allowed"})` });
    return gate;
  }

  /** Human approves the selected change (admin surface). */
  approve(): GateDecision {
    if (!this.lastGate || !this.lastGate.allowed) throw new Error("no approvable gate decision");
    this.workflow = "APPROVED";
    this.phase = { name: "approved" };
    this.flight.record({ actor: "human", type: "human_approved", planId: this.selectedPlanId ?? undefined, resultSummary: "human approved change" });
    return this.lastGate;
  }

  /** Human rejects the selected change (admin surface). */
  reject(reason = "rejected by human"): void {
    this.workflow = "DEVIATION";
    this.phase = { name: "deviated" };
    this.flight.record({ actor: "human", type: "human_rejected", planId: this.selectedPlanId ?? undefined, resultSummary: reason });
  }

  /**
   * Execute the approved plan on the LIVE world through Change Control, then
   * transition to EXECUTED and make the actual result measurable for verify().
   */
  executeChange(): { ok: boolean; health: string; error?: string } {
    const runner = this.requireRunner();
    const plan = this.selectedPlan();
    const gate = this.lastGate;

    if (this.paused) {
      throw Object.assign(new Error("agent is paused; cannot execute"), { code: "PAUSED" });
    }
    if (this.workflow !== "APPROVED") {
      throw Object.assign(new Error(`executeChange requires APPROVED, got ${this.workflow}`), { code: "WRONG_STATE" });
    }

    this.workflow = "EXECUTING";
    this.flight.record({ actor: "system", type: "execution_started", planId: plan.id });

    const action = plan.actions[0];
    if (!action) {
      this.flight.record({ actor: "system", type: "execution_completed", planId: plan.id, resultSummary: "no action to execute" });
      this.workflow = "EXECUTED";
      return { ok: false, health: runner.health(), error: "plan has no actions" };
    }

    const res = runner.executeChange(action.type as ActionType, (action.parameters ?? {}) as Record<string, number | string>, { neutralizeDisturbances: true });
    runner.settle(24);

    // Record actual result for prediction-vs-reality comparison.
    const kpis = runner.agentView().kpis;
    this.verification.recordActual({
      planId: plan.id,
      stateVersion: this.currentVersion,
      actual: metricsOf(kpis),
      actualHealth: kpis.systemHealth,
      timestamp: Date.now(),
    });

    // A committed change moves the world to a new state version.
    this.currentVersion += 1;

    this.workflow = "EXECUTED";
    this.phase = { name: "executed" };
    this.flight.record({ actor: "system", type: "execution_completed", planId: plan.id, resultSummary: `executed ${action.type}; ok=${res.ok}; health=${runner.health()}`, detail: gate ? { gate: gate.stage } : undefined });
    return { ok: res.ok, health: runner.health(), error: res.ok ? undefined : res.unmet.join(", ") };
  }

  /** Compare prediction vs reality and move to COMPLETE (or DEVIATION). */
  verifyChange(): { verdict: ReturnType<PredictionVsReality["compare"]>; health: string } {
    const runner = this.requireRunner();
    const plan = this.selectedPlan();
    const comp = this.verification.compare(plan.id);
    this.workflow = comp.verdict === "HEALTHY" ? "COMPLETE" : "DEVIATION";
    this.phase = comp.verdict === "HEALTHY" ? { name: "complete" } : { name: "deviated", verdict: comp.verdict };
    this.flight.record({ actor: "system", type: "verification", planId: plan.id, resultSummary: `verdict ${comp.verdict}`, detail: { deviations: comp.deviations } });
    return { verdict: comp, health: runner.health() };
  }

  /** Roll back the executed change. */
  rollbackChange(): void {
    const runner = this.requireRunner();
    const plan = this.selectedPlan();
    const original = plan.actions[0]?.type as ActionType;
    const rollbackFor: Partial<Record<ActionType, ActionType>> = {
      increase_cache_capacity: "restart_cache",
      scale_service: "scale_service",
      change_configuration: "restore_configuration",
      scale_database: "restore_configuration",
    };
    const rb = rollbackFor[original] ?? "restart_cache";
    runner.executeChange((rb ?? "restart_cache") as ActionType, {}, { neutralizeDisturbances: true });
    runner.settle(24);
    this.workflow = "RECOVERING";
    this.phase = { name: "recovered" };
    this.flight.record({ actor: "system", type: "rollback", planId: plan.id, resultSummary: `rolled back ${original} via ${rb}; health=${runner.health()}` });
  }

  /** Agent requests a human decision (blind-safe ask). */
  requestHumanDecision(ask: string): { requestId: string } {
    const id = `req-${++this.requestCounter}`;
    this.phase = { name: "awaiting", requestId: id };
    this.workflow = "WAITING_FOR_APPROVAL";
    this.flight.record({ actor: "agent", type: "approval_requested", planId: this.selectedPlanId ?? undefined, resultSummary: ask, detail: { requestId: id } });
    return { requestId: id };
  }

  // ---------------------------------------------------------------------------
  // Phase 12 — Bounded delegation + human takeover
  // ---------------------------------------------------------------------------

  /**
   * Grant a bounded, expiring delegation to the agent (Implementation.md §12.1).
   * `durationMs` bounds how long authority lasts; scope, riskCeiling and
   * reversibleOnly bound what it covers. The authority engine enforces all of
   * these at the gate.
   */
  grantDelegation(g: {
    riskCeiling: "low" | "medium" | "high";
    durationMs: number;
    scope: string[];
    approvalStillRequired?: boolean;
    reversibleOnly?: boolean;
  }): DelegationGrant {
    if (this.workflow === "IDLE") throw new Error("start a scenario before granting delegation");
    if (g.durationMs <= 0) throw new Error("delegation duration must be positive");
    const delegation: DelegationGrant = {
      riskCeiling: g.riskCeiling,
      expiresAt: Date.now() + g.durationMs,
      scope: g.scope,
      approvalStillRequired: g.approvalStillRequired ?? true,
      reversibleOnly: g.reversibleOnly ?? false,
    };
    this.delegation = delegation;
    this.flight.record({
      actor: "human",
      type: "delegation_granted",
      resultSummary:
        `delegated authority: ceiling=${delegation.riskCeiling}, scope=[${delegation.scope.join(",")}], ` +
        `durationMs=${g.durationMs}, expiresAt=${delegation.expiresAt}`,
      detail: { ...delegation },
    });
    return delegation;
  }

  /** Revoke the current delegation (expires it immediately). */
  revokeDelegation(): void {
    if (!this.delegation) throw new Error("no delegation to revoke");
    const prev = this.delegation;
    this.delegation = null;
    this.flight.record({ actor: "human", type: "delegation_revoked", resultSummary: "delegation revoked", detail: { ...prev } });
  }

  /** Whether the current delegation has expired. */
  delegationExpired(): boolean {
    return this.delegation !== null && this.delegation.expiresAt <= Date.now();
  }

  /** Pause the agent immediately (Implementation.md §12.2). */
  pauseAgent(): void {
    this.paused = true;
    this.flight.record({ actor: "human", type: "agent_paused", resultSummary: `agent paused at workflow=${this.workflow}` });
  }

  /** Resume the agent from the *current* state (Implementation.md §12.4). */
  resumeAgent(): { replanned: boolean; reason: string } {
    if (!this.paused) throw new Error("agent is not paused");
    this.paused = false;
    const hadStale = this.orchestrator
      ? this.orchestrator.last.plans.some((p) => p.stateVersion !== this.currentVersion)
      : false;
    // Resume from the new current state: re-reason over the live view so the
    // agent does not continue from stale assumptions.
    let replanned = false;
    if (this.runner) {
      const runner = this.requireRunner();
      const fresh = this.orchestrator!.reason(
        this.orchestrator!.last.contract?.goal ?? "restore system health",
        runner.agentView()
      );
      this.workflow = fresh.plans.length > 0 ? "PLAN_READY" : "INVESTIGATING";
      this.selectedPlanId = null;
      this.lastGate = null;
      this.humanMutations = [];
      this.flight.record({
        actor: "system",
        type: "agent_resumed",
        resultSummary: `agent resumed and replanned from state version ${this.currentVersion}; ${fresh.plans.length} plans`,
        detail: { hadStale, newStateVersion: this.currentVersion },
      });
      replanned = true;
    }
    return { replanned, reason: hadStale ? "previous plan was stale; agent replanned" : "agent resumed from current state" };
  }

  /**
   * Human takeover (Implementation.md §12.3): the human manually mutates the
   * live system through a controlled action. This advances the state version,
   * which invalidates any plan the agent created earlier (stale-plan detection)
   * and is recorded for conflict detection.
   */
  humanTakeover(actionType: ActionType, params: Record<string, number | string> = {}, note = "human modified the system manually"): { ok: boolean; stateVersion: number; health: string; error?: string } {
    const runner = this.requireRunner();
    const wasPaused = this.paused;
    this.paused = true;
    const res = runner.executeChange(actionType, params, { neutralizeDisturbances: false });
    runner.settle(10);
    const newVersion = ++this.currentVersion;
    const now = Date.now();
    const affected = resourcesForAction(actionType);
    for (const resource of affected) {
      this.humanMutations.push({ resource, actor: "human" as ActorType, version: newVersion, timestamp: now });
    }
    // Human takeover takes control away from the current agent plan.
    this.selectedPlanId = null;
    this.lastGate = null;
    this.delegation = null;
    if (!wasPaused) this.paused = false; // takeover is a momentary pause while mutating
    this.flight.record({
      actor: "human",
      type: "human_takeover",
      resultSummary: `human ${actionType}: ${res.ok ? "applied" : res.unmet.join(", ")}; state version ${newVersion}`,
      detail: { note, actionType, stateVersion: newVersion, affected },
    });
    return { ok: res.ok, stateVersion: newVersion, health: runner.health(), error: res.ok ? undefined : res.unmet.join(", ") };
  }

  /** Public, blind-safe view for the UI and tool runtime. */
  view(): PublicView {
    const runner = this.runner;
    const view = runner ? runner.agentView() : null;
    const last = this.orchestrator?.last;
    return {
      workflow: this.workflow,
      statusLabel: humanLabel(this.workflow),
      phase: this.phase,
      scenario: runner ? { ...runner.session() } : null,
      health: view ? view.health : "unknown",
      kpis: view ? view.kpis : (null as never),
      metrics: view ? view.metrics : [],
      intent: last?.contract ?? null,
      investigation: last?.investigation ?? null,
      hypotheses: last?.hypotheses ?? [],
      plans: last?.plans ?? [],
      simulations: last?.simulations ?? [],
      topHypothesis: last?.topHypothesis ?? null,
      selectedPlanId: this.selectedPlanId,
      gate: this.lastGate,
      verification: this.verification.summary(),
      flight: { ...this.flight.summary(), steps: this.flight.replay().steps },
      blind: view ? view.blind : true,
      stateVersion: this.currentVersion,
      delegation: this.delegation,
      paused: this.paused,
      humanMutations: this.humanMutations,
    };
  }

  /** Tool runtime bridge used by the WebMCP registry. */
  get asToolRuntime() {
    const self = this;
    return {
      workflowState: () => self.workflow,
      execute: async (name: ToolName, args: Record<string, unknown>) => {
        try {
          return self.runTool(name, args);
        } catch (err) {
          return { ok: false, error: (err as Error).message };
        }
      },
    };
  }

  private selectedPlan(): Plan {
    const last = this.orchestrator!.last;
    const plan = last.plans.find((p) => p.id === this.selectedPlanId);
    if (!plan) throw new Error("no selected plan");
    return plan;
  }

  private runTool(name: ToolName, args: Record<string, unknown>): { ok: boolean; data?: unknown; error?: string } {
    const runner = this.requireRunner();
    switch (name) {
      case "inspect_system":
        return { ok: true, data: { health: runner.health(), kpis: runner.agentView().kpis, metrics: runner.agentView().metrics } };
      case "investigate": {
        const inv = this.orchestrator?.investigate(runner.agentView());
        return { ok: true, data: inv };
      }
      case "get_evidence":
        return { ok: true, data: this.orchestrator?.last.investigation ?? null };
      case "inspect_history":
        return { ok: true, data: this.flight.replay() };
      default:
        return { ok: false, error: `tool '${name}' not implemented in this runtime` };
    }
  }
}

function humanLabel(s: WorkflowState): string {
  const m: Record<WorkflowState, string> = {
    IDLE: "Idle",
    CONTRACT_SET: "Intent contract set",
    INVESTIGATING: "Investigating",
    PLAN_READY: "Planning",
    SIMULATED: "Plans simulated",
    WAITING_FOR_APPROVAL: "Waiting for approval",
    APPROVED: "Approved",
    EXECUTING: "Executing",
    EXECUTED: "Executed",
    VERIFYING: "Verifying",
    DEVIATION: "Deviation detected",
    RECOVERING: "Recovering",
    COMPLETE: "Complete",
  };
  return m[s];
}

/** Map an action type to the resource(s) it primarily touches (for conflict tracking). */
function resourcesForAction(type: string): string[] {
  const map: Record<string, string[]> = {
    increase_cache_capacity: ["cache"],
    restart_cache: ["cache"],
    scale_service: ["checkout"],
    scale_database: ["database", "queue"],
    rollback_deployment: ["api-gateway", "checkout"],
    change_configuration: ["configuration", "database"],
    restore_configuration: ["database", "cache", "api-gateway"],
    do_nothing: [],
  };
  return map[type] ?? [type];
}

let _session: ChangeRoomSession | null = null;
/** Module-level singleton for the in-memory sandbox session. */
export function getSession(): ChangeRoomSession {
  if (!_session) _session = new ChangeRoomSession();
  return _session;
}
