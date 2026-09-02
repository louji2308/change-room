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
import type { UndoFrame } from "@change-room/scenarios";
import type { ActionType, BusinessKpis, PredictionResult } from "@change-room/simulator";
import { metricsOf } from "@change-room/verification";
import { AgentOrchestrator, challengePlan } from "@change-room/agent";
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
import { isValidId } from "@change-room/webmcp";

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
  /** Snapshot undo frames keyed by plan id for rollback. */
  private undoFrames = new Map<string, UndoFrame>();

  /** Most recent agent goal (Phase 17: reused by the generate_plans tool). */
  private lastGoal: string | null = null;
  /** Most recent human-decision request id (Phase 17). */
  private lastRequestId: string | null = null;

  /** Scenario the sandbox is running (named scenario id), for admin/debug only. */
  private scenarioName: string | null = null;

  reset(): void {
    this.runner = null;
    this.orchestrator = null;
    this.workflow = "IDLE";
    this.phase = { name: "idle" };
    this.selectedPlanId = null;
    this.lastGate = null;
    this.lastGoal = null;
    this.lastRequestId = null;
    this.flight = new FlightRecorder();
    this.verification = new PredictionVsReality();
    this.scenarioName = null;
    this.currentVersion = 0;
    this.delegation = null;
    this.paused = false;
    this.humanMutations = [];
    this.undoFrames.clear();
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
    this.lastGoal = goal;
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
        intentContract: this.orchestrator!.last.contract,
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

  /**
   * Read-only form of `prepareChange` used by the `validate_policy` WebMCP tool.
   * Computes the gate decision for the current selected plan WITHOUT recording a
   * prediction or advancing the workflow — so a validation call never mutates
   * state or double-transitions. Returns the gate result untouched.
   */
  validateChange(): GateDecision {
    const runner = this.requireRunner();
    const plan = this.selectedPlan();
    const gate = evaluateGate(
      {
        plan,
        currentStateVersion: this.currentVersion,
        permission: this.permission,
        delegation: this.delegation,
        intentContract: this.orchestrator!.last.contract,
        now: Date.now(),
        mutationsSince: this.humanMutations,
      },
      this.policy
    );
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
    const intentContract = this.orchestrator!.last.contract;
    const gate = this.lastGate;

    if (this.paused) {
      throw Object.assign(new Error("agent is paused; cannot execute"), { code: "PAUSED" });
    }
    if (this.workflow !== "APPROVED") {
      throw Object.assign(new Error(`executeChange requires APPROVED, got ${this.workflow}`), { code: "WRONG_STATE" });
    }

    // Phase 14: Re-validate freshness at execution time — the state may have
    // advanced since prepareChange() due to a concurrent human takeover or
    // automation. If stale, block execution and transition to STALE.
    if (plan.stateVersion !== this.currentVersion) {
      this.workflow = "STALE";
      this.phase = { name: "deviated", verdict: "STALE" };
      this.flight.record({
        actor: "system",
        type: "execution_started",
        planId: plan.id,
        resultSummary: `STALE_PLAN: plan bound to version ${plan.stateVersion} but current state is ${this.currentVersion}`,
      });
      return { ok: false, health: runner.health(), error: `STALE_PLAN: plan bound to version ${plan.stateVersion} but current state is ${this.currentVersion}` };
    }

    // P0-5: Re-evaluate gate at execution time with current state. Between
    // prepareChange() and now the world may have changed (new disturbances,
    // delegation expiry, human mutations, policy shift). The gate must catch it.
    const execGate = evaluateGate(
      {
        plan,
        intentContract,
        currentStateVersion: this.currentVersion,
        permission: this.permission,
        delegation: this.delegation,
        now: Date.now(),
        mutationsSince: this.humanMutations,
      },
      this.policy
    );
    if (!execGate.allowed) {
      this.workflow = "STALE";
      this.phase = { name: "deviated", verdict: "GATE_DENIED" };
      this.lastGate = execGate;
      this.flight.record({
        actor: "system",
        type: "execution_started",
        planId: plan.id,
        resultSummary: `GATE_DENIED_AT_EXECUTION: ${execGate.stage}: ${execGate.reason}`,
      });
      return { ok: false, health: runner.health(), error: `GATE_DENIED_AT_EXECUTION: ${execGate.stage}: ${execGate.reason}` };
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

    // P0-6: Capture the undo frame from the engine for snapshot-based rollback.
    const undoFrame = runner.popUndoFrame();
    if (undoFrame) {
      this.undoFrames.set(plan.id, undoFrame);
    }

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

    // P0-6: Use the stored undo frame for exact snapshot-based rollback when
    // available. This reverts the base tuning, latency modifiers and
    // disturbances to the exact pre-execution state — much more precise than
    // the inverse-op approximation.
    const undoFrame = this.undoFrames.get(plan.id);
    if (undoFrame) {
      this.undoFrames.delete(plan.id);
      const res = runner.rollback();
      runner.settle(24);
      this.workflow = "RECOVERING";
      this.phase = { name: "recovered" };
      this.flight.record({ actor: "system", type: "rollback", planId: plan.id, resultSummary: `snapshot rollback: ok=${res.ok}; health=${runner.health()}` });
      return;
    }

    // Fallback: inverse-op rollback for operations without an undo frame
    // (backward compatibility during transition).
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
    this.flight.record({ actor: "system", type: "rollback", planId: plan.id, resultSummary: `inverse-op rollback ${original} via ${rb}; health=${runner.health()}` });
  }

  /** Agent requests a human decision (blind-safe ask). */
  requestHumanDecision(ask: string): { requestId: string } {
    const id = `req-${++this.requestCounter}`;
    this.lastRequestId = id;
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
      this.undoFrames.clear();
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

  /**
   * Phase 14 — Reconcile a stale plan: re-observe the live world, compare
   * against the previous hypothesis, update if needed, and replan from the
   * new state version. This is the agent's recovery path when concurrent
   * changes invalidate its plan.
   */
  reconcileStalePlan(): { reconciled: boolean; plans: number; reason: string } {
    const runner = this.requireRunner();
    if (this.paused) throw Object.assign(new Error("agent is paused; cannot reconcile"), { code: "PAUSED" });

    const previousPlan = this.selectedPlanId
      ? this.orchestrator?.last.plans.find((p) => p.id === this.selectedPlanId) ?? null
      : null;

    // Re-observe the live world.
    const freshView = runner.agentView();
    const freshResult = this.orchestrator!.reason(
      this.orchestrator!.last.contract?.goal ?? "restore system health",
      freshView
    );

    // Determine what changed.
    let reason: string;
    if (previousPlan) {
      const prevVersion = previousPlan.stateVersion;
      const currentVersion = this.currentVersion;
      reason = `plan was stale (version ${prevVersion} vs current ${currentVersion}); re-observed ${freshResult.hypotheses.length} hypotheses, ${freshResult.plans.length} plans`;
    } else {
      reason = `reconciled without previous plan; ${freshResult.hypotheses.length} hypotheses, ${freshResult.plans.length} plans`;
    }

    // Reset selection — the agent must pick a new plan from the fresh set.
    this.selectedPlanId = null;
    this.lastGate = null;
    this.humanMutations = [];
    this.undoFrames.clear();
    this.workflow = freshResult.plans.length > 0 ? "PLAN_READY" : "INVESTIGATING";

    this.flight.record({
      actor: "agent",
      type: "observation",
      resultSummary: reason,
      detail: { reconciled: true, newStateVersion: this.currentVersion, hypotheses: freshResult.hypotheses.length, plans: freshResult.plans.length },
    });

    return { reconciled: true, plans: freshResult.plans.length, reason };
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

    // Phase 15 (input validation): reject unknown tool names outright.
    const KNOWN_TOOLS = new Set<ToolName>([
      "inspect_system",
      "investigate",
      "get_evidence",
      "inspect_history",
      "generate_plans",
      "compare_plans",
      "simulate_plan",
      "challenge_plan",
      "prepare_change",
      "validate_policy",
      "request_human_decision",
      "execute_change",
      "verify_change",
      "rollback_change",
    ]);
    if (!KNOWN_TOOLS.has(name)) {
      return { ok: false, error: `unknown tool: '${name}'` };
    }

    // Strict id validation for any tool that takes a planId (15.3: reject invalid IDs),
    // plus action-type enum validation where relevant.
    for (const key of Object.keys(args)) {
      if (key.endsWith("Id") && (args[key] !== undefined && args[key] !== null)) {
        if (!isValidId(args[key])) {
          return { ok: false, error: `invalid input: field '${key}' is not a valid id` };
        }
      }
    }

    switch (name) {
      case "inspect_system":
        return { ok: true, data: { health: runner.health(), kpis: runner.agentView().kpis, metrics: runner.agentView().metrics } };
      case "investigate": {
        // Phase 17 (WebMCP evaluation): advance the state machine as an agent
        // observes — INTENT → INVESTIGATING — so the tool-following flow can
        // progress to planning via the WebMCP surface alone.
        if (this.workflow === "CONTRACT_SET") {
          this.workflow = "INVESTIGATING";
          this.flight.record({ actor: "agent", type: "observation", resultSummary: "agent began investigation via WebMCP", detail: { workflow: this.workflow } });
        }
        const inv = this.orchestrator?.investigate(runner.agentView());
        return { ok: true, data: inv };
      }
      case "get_evidence":
        return { ok: true, data: this.orchestrator?.last.investigation ?? null };
      case "inspect_history":
        if (args.limit !== undefined && (typeof args.limit !== "number" || !Number.isInteger(args.limit) || args.limit < 1 || args.limit > 10000)) {
          return { ok: false, error: "invalid input: 'limit' must be an integer in [1, 10000]" };
        }
        return { ok: true, data: this.flight.replay() };
      case "generate_plans": {
        // Phase 17: an agent reaches planning directly through the tool surface.
        if (this.workflow !== "CONTRACT_SET" && this.workflow !== "INVESTIGATING" && this.workflow !== "DEVIATION" && this.workflow !== "STALE") {
          return { ok: false, error: `generate_plans requires CONTRACT_SET/INVESTIGATING/DEVIATION/STALE, got ${this.workflow}` };
        }
        const goal = this.lastGoal ?? "restore system health";
        const result = this.reason(goal);
        return { ok: true, data: { hypotheses: result.hypotheses, plans: result.plans, topHypothesis: result.topHypothesis } };
      }
      case "compare_plans": {
        return { ok: true, data: { plans: this.orchestrator?.last.plans ?? [], simulations: this.orchestrator?.last.simulations ?? [] } };
      }
      case "simulate_plan": {
        if (this.workflow !== "PLAN_READY" && this.workflow !== "SIMULATED") {
          return { ok: false, error: `simulate_plan requires PLAN_READY or SIMULATED, got ${this.workflow}` };
        }
        const planId = String(args.planId ?? "");
        if (!isValidId(planId)) {
          return { ok: false, error: `invalid input: 'planId' is not a valid id` };
        }
        this.selectPlan(planId);
        const sim = this.orchestrator!.last.simulations.find((s) => s.plan.id === planId);
        return { ok: true, data: sim ?? { error: "no simulation recorded for plan" } };
      }
      case "prepare_change": {
        if (this.workflow !== "SIMULATED" && this.workflow !== "WAITING_FOR_APPROVAL") {
          return { ok: false, error: `prepare_change requires SIMULATED, got ${this.workflow}` };
        }
        const gate = this.prepareChange();
        return { ok: true, data: gate };
      }
      case "validate_policy": {
        // Pure read-only: compute the gate without recording or transitioning.
        if (this.workflow !== "SIMULATED" && this.workflow !== "WAITING_FOR_APPROVAL") {
          return { ok: false, error: `validate_policy requires SIMULATED, got ${this.workflow}` };
        }
        return { ok: true, data: this.validateChange() };
      }
      case "request_human_decision": {
        const ask = String(args.ask ?? "agent requests a decision");
        const requestId = String(args.requestId ?? this.lastRequestId ?? "");
        const res = this.requestHumanDecision(ask);
        this.lastRequestId = requestId || res.requestId;
        return { ok: true, data: res };
      }
      case "execute_change": {
        if (this.workflow !== "APPROVED") {
          return { ok: false, error: `execute_change requires APPROVED authority; current state is ${this.workflow}` };
        }
        // An agent may pass the approved planId; reconcile with the selected plan.
        if (args.planId !== undefined) {
          const planId = String(args.planId);
          const selected = this.selectedPlan();
          if (planId !== selected.id) {
            return { ok: false, error: `execute_change: planId '${planId}' is not the approved plan '${selected.id}'` };
          }
        }
        const res = this.executeChange();
        return { ok: true, data: res };
      }
      case "verify_change": {
        if (this.workflow !== "EXECUTED" && this.workflow !== "EXECUTING" && this.workflow !== "VERIFYING" && this.workflow !== "DEVIATION" && this.workflow !== "RECOVERING" && this.workflow !== "COMPLETE") {
          return { ok: false, error: `verify_change requires an executed/recovered change, got ${this.workflow}` };
        }
        const res = this.verifyChange();
        return { ok: true, data: res };
      }
      case "rollback_change": {
        if (this.workflow !== "EXECUTED" && this.workflow !== "DEVIATION" && this.workflow !== "RECOVERING") {
          return { ok: false, error: `rollback_change requires EXECUTED/DEVIATION/RECOVERING, got ${this.workflow}` };
        }
        this.rollbackChange();
        return { ok: true, data: { health: runner.health() } };
      }
      case "challenge_plan": {
        if (this.workflow !== "PLAN_READY" && this.workflow !== "SIMULATED") {
          return { ok: false, error: `challenge_plan requires PLAN_READY or SIMULATED, got ${this.workflow}` };
        }
        const planId = String(args.planId ?? "");
        if (!isValidId(planId)) {
          return { ok: false, error: `invalid input: 'planId' is not a valid id` };
        }
        const last = this.orchestrator!.last;
        const res = challengePlan(
          {
            plans: last.plans,
            evidence: last.investigation?.evidence ?? [],
            hypotheses: last.hypotheses,
            topHypothesis: last.topHypothesis,
            simulations: last.simulations,
            current: runner.agentView().kpis,
          },
          planId
        );
        if (!res.ok) return { ok: false, error: res.error };
        return { ok: true, data: res.report };
      }
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
    STALE: "Plan stale — state changed",
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
