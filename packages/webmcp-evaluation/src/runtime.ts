/**
 * WebMCP evaluation runtime (Phase 17).
 *
 * A faithful, package-level implementation of the Change Room `ToolRuntime`
 * backed by the real causal simulation + reasoning + control packages. It
 * reproduces the app session's tool wiring (observe → investigate → plan →
 * simulate → prepare → approve → execute → verify → recovery) so an evaluation
 * can drive the *actual* WebMCP surface (`WebmcpRegistry`) end to end without
 * the Next.js host.
 *
 * Like the app session, this runtime is blind-safe: it never returns ground
 * truth (seed/disturbances/cause) on any tool surface. The Change Control gate
 * is enforced through the real `evaluateGate` on the orchestrator's own plans.
 */

import { ScenarioRunner } from "@change-room/scenarios";
import { AgentOrchestrator, challengePlan } from "@change-room/agent";
import { evaluateGate, PolicyEngine, type GateDecision, type StateMutation } from "@change-room/control";
import { FlightRecorder } from "@change-room/flight-recorder";
import { PredictionVsReality } from "@change-room/verification";
import { WebmcpRegistry, validateIdField, type ToolRuntime } from "@change-room/webmcp";
import type { ToolName, WorkflowState, Plan } from "@change-room/domain";
import type { ActionType } from "@change-room/simulator";

const AGENT_LEVEL = "L3" as const;

function defaultPolicy(): PolicyEngine {
  return new PolicyEngine({
    rules: [
      { id: "db-schema", forbidResources: ["schema"], forbidActionTypes: ["change_configuration"], reason: "database schema must not be changed at runtime" },
      { id: "prod-config", requireApprovalFor: ["change_configuration", "scale_database", "rollback_deployment"], reason: "production configuration changes require human approval" },
      { id: "irreversible", forbidIrreversible: true, reason: "irreversible operations are forbidden" },
    ],
  });
}

/** A mutable evaluation runtime exposing the full (now complete) tool surface. */
export class WebMCPRuntime implements ToolRuntime {
  runner: ScenarioRunner;
  orchestrator: AgentOrchestrator;
  policy = defaultPolicy();
  workflow: WorkflowState = "IDLE";
  flight = new FlightRecorder();
  verification = new PredictionVsReality();
  selectedPlanId: string | null = null;
  lastGate: GateDecision | null = null;
  approved = false;
  humanMutations: StateMutation[] = [];
  lastGoal: string | null = null;
  reqCounter = 0;
  /** Current live state version (advances on execute / forced bumps). */
  currentStateVersion: number;
  /** When set, forces `execute_change` to fail (Phase 17.5 execution-error probe). */
  injectExecutionError: string | null = null;

  /** Last plan-selection error, read after a failed `selectPlan`. */
  private _selectError = "no plan selected";

  constructor(scenarioId = "cache-failure") {
    this.runner = ScenarioRunner.setup(scenarioId);
    this.runner.start();
    this.runner.settle(20);
    this.currentStateVersion = this.runner.session().startedAt;
    this.orchestrator = new AgentOrchestrator({
      sim: { predict: (a, o) => this.runner.predict(a, o) },
      currentStateVersion: () => this.currentStateVersion,
    });
    this.workflow = "CONTRACT_SET";
  }

  // -- ToolRuntime interface --------------------------------------------------
  workflowState(): WorkflowState {
    return this.workflow;
  }

  async execute(name: ToolName, args: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    return this.runTool(name, args);
  }

  /** Registry bound to this runtime — the exact WebMCP surface an agent sees. */
  get registry(): WebmcpRegistry {
    return new WebmcpRegistry(this);
  }

  /** The currently selected (real) plan, if any. */
  get plan(): Plan | null {
    if (!this.selectedPlanId) return null;
    return this.orchestrator.last?.plans.find((p) => p.id === this.selectedPlanId) ?? null;
  }

  /** Select a plan by id (validated + must exist). Returns false on failure. */
  selectPlan(planId: string): boolean {
    const ok = validateIdField("planId", planId);
    if (ok) {
      this._selectError = ok;
      return false;
    }
    const plan = this.orchestrator.last?.plans.find((p) => p.id === planId);
    if (!plan) {
      this._selectError = `unknown plan '${planId}'`;
      return false;
    }
    this.selectedPlanId = planId;
    return true;
  }

  // -- Human-facing flow helpers (used by the harness) ------------------------

  /** Human approves the currently prepared change. */
  humanApprove(): void {
    this.approved = true;
    this.workflow = "APPROVED";
  }

  /** Human rejects the currently prepared change. */
  humanReject(): void {
    this.approved = false;
    this.workflow = "DEVIATION";
  }

  /** Advance the world to a new state version (used to build stale plans). */
  bumpStateVersion(): void {
    this.runner.settle(8);
    this.currentStateVersion = Math.round(this.runner.agentView().timestamp);
  }

  // -- Tool dispatch (mirrors the app session's runTool) ----------------------

  private runTool(name: ToolName, args: Record<string, unknown>): { ok: boolean; data?: unknown; error?: string } {
    const runner = this.runner;
    switch (name) {
      case "inspect_system":
        return { ok: true, data: { health: runner.health(), kpis: runner.agentView().kpis, metrics: runner.agentView().metrics } };
      case "investigate": {
        if (this.workflow === "CONTRACT_SET") {
          this.workflow = "INVESTIGATING";
          this.flight.record({ actor: "agent", type: "observation", resultSummary: "agent began investigation via WebMCP" });
        }
        return { ok: true, data: this.orchestrator.investigate(runner.agentView()) };
      }
      case "get_evidence":
        return { ok: true, data: this.orchestrator.last?.investigation ?? null };
      case "inspect_history":
        return { ok: true, data: this.flight.replay() };
      case "generate_plans": {
        if (this.workflow !== "CONTRACT_SET" && this.workflow !== "INVESTIGATING" && this.workflow !== "DEVIATION") {
          return { ok: false, error: `generate_plans requires CONTRACT_SET/INVESTIGATING/DEVIATION, got ${this.workflow}` };
        }
        const goal = this.lastGoal ?? "restore system health";
        const res = this.orchestrator.reason(goal, runner.agentView());
        this.lastGoal = goal;
        this.workflow = res.plans.length > 0 ? "PLAN_READY" : "INVESTIGATING";
        return { ok: true, data: { hypotheses: res.hypotheses, plans: res.plans, topHypothesis: res.topHypothesis } };
      }
      case "compare_plans":
        return { ok: true, data: { plans: this.orchestrator.last?.plans ?? [], simulations: this.orchestrator.last?.simulations ?? [] } };
      case "simulate_plan": {
        const planId = String(args.planId ?? "");
        const bad = validateIdField("planId", planId);
        if (bad) return { ok: false, error: bad };
        const last = this.orchestrator.last;
        const plan = last?.plans.find((p) => p.id === planId);
        if (!plan) return { ok: false, error: `unknown plan '${planId}'` };
        this.selectedPlanId = planId;
        this.workflow = "SIMULATED";
        const sim = last.simulations.find((s) => s.plan.id === planId);
        return { ok: true, data: sim ?? { error: "no simulation recorded for plan" } };
      }
      case "challenge_plan": {
        if (this.workflow !== "PLAN_READY" && this.workflow !== "SIMULATED") return { ok: false, error: `challenge_plan requires PLAN_READY or SIMULATED, got ${this.workflow}` };
        const last = this.orchestrator.last;
        const res = challengePlan(
          { plans: last?.plans ?? [], evidence: last?.investigation?.evidence ?? [], hypotheses: last?.hypotheses ?? [], topHypothesis: last?.topHypothesis, simulations: last?.simulations ?? [], current: runner.agentView().kpis },
          String(args.planId ?? "")
        );
        if (!res.ok) return { ok: false, error: res.error };
        return { ok: true, data: res.report };
      }
      case "prepare_change": {
        const planId = String(args.planId ?? "");
        if (!this.selectPlan(planId)) return { ok: false, error: this._selectError };
        if (this.workflow !== "SIMULATED" && this.workflow !== "PLAN_READY" && this.workflow !== "WAITING_FOR_APPROVAL") return { ok: false, error: `prepare_change requires SIMULATED state, got ${this.workflow}` };
        const gate = this.computeGate();
        this.lastGate = gate;
        if (gate.allowed) {
          this.recordPrediction();
          this.workflow = gate.approvalRequired ? "WAITING_FOR_APPROVAL" : "APPROVED";
        }
        return { ok: true, data: gate };
      }
      case "validate_policy": {
        const planId = String(args.planId ?? "");
        if (!this.selectPlan(planId)) return { ok: false, error: this._selectError };
        return { ok: true, data: this.computeGate() };
      }
      case "request_human_decision": {
        const ask = String(args.ask ?? "agent requests a decision");
        this.workflow = "WAITING_FOR_APPROVAL";
        return { ok: true, data: { requestId: `req-${++this.reqCounter}`, ask } };
      }
      case "execute_change": {
        const planId = String(args.planId ?? "");
        if (!this.selectPlan(planId)) return { ok: false, error: this._selectError };
        if (this.workflow !== "APPROVED" || !this.approved) {
          return { ok: false, error: `execute_change requires APPROVED authority; current state is ${this.workflow}` };
        }
        if (this.injectExecutionError) {
          const err = this.injectExecutionError;
          this.injectExecutionError = null;
          this.workflow = "EXECUTED";
          return { ok: false, error: err };
        }
        const plan = this.plan;
        if (!plan) return { ok: false, error: "no approved plan selected" };
        const action = plan.actions[0];
        this.workflow = "EXECUTING";
        const res = this.runner.executeChange(action.type as ActionType, action.parameters ?? {}, { neutralizeDisturbances: true });
        this.runner.settle(24);
        const kpis = this.runner.agentView().kpis;
        if (!res.ok) {
          this.workflow = "EXECUTED";
          return { ok: false, error: `execution failed: ${res.unmet.join(", ")}` };
        }
        if (this.selectedPlanId) this.verification.recordActual({ planId: this.selectedPlanId, stateVersion: this.currentStateVersion, actual: metricsOf(kpis as unknown as Record<string, unknown>), actualHealth: kpis.systemHealth, timestamp: Date.now() });
        this.currentStateVersion += 1;
        this.workflow = "EXECUTED";
        this.flight.record({ actor: "system", type: "execution_completed", planId: plan.id, resultSummary: `executed ${action.type}; ok=true; health=${this.runner.health()}` });
        return { ok: true, data: { ok: true, health: this.runner.health() } };
      }
      case "verify_change": {
        const planId = String(args.planId ?? "");
        if (!this.selectPlan(planId)) return { ok: false, error: this._selectError };
        if (this.workflow !== "EXECUTED" && this.workflow !== "EXECUTING" && this.workflow !== "DEVIATION" && this.workflow !== "RECOVERING") {
          return { ok: false, error: `verify_change requires an executed/recovered change, got ${this.workflow}` };
        }
        const comp = this.verification.compare(planId);
        this.workflow = comp.verdict === "HEALTHY" ? "COMPLETE" : "DEVIATION";
        return { ok: true, data: comp };
      }
      case "rollback_change": {
        const planId = String(args.planId ?? "");
        if (!this.selectPlan(planId)) return { ok: false, error: this._selectError };
        if (this.workflow !== "EXECUTED" && this.workflow !== "DEVIATION" && this.workflow !== "RECOVERING") return { ok: false, error: `rollback_change requires EXECUTED/DEVIATION/RECOVERING, got ${this.workflow}` };
        const rb = this.runner.rollback();
        this.runner.settle(24);
        this.workflow = "RECOVERING";
        this.flight.record({ actor: "system", type: "rollback", planId: planId, resultSummary: `rolled back; ok=${rb.ok}` });
        return { ok: true, data: { ok: rb.ok, health: this.runner.health() } };
      }
      default:
        return { ok: false, error: `tool '${name}' not implemented in this runtime` };
    }
  }

  private recordPrediction(): void {
    if (!this.selectedPlanId) return;
    const sim = this.orchestrator.last?.simulations.find((s) => s.plan.id === this.selectedPlanId);
    if (sim?.prediction && sim.predictedKpis) {
      this.verification.recordPrediction({
        planId: this.selectedPlanId,
        stateVersion: this.currentStateVersion,
        predicted: sim.predictedKpis,
        predictedHealth: sim.prediction.kpis.systemHealth,
        assumptions: sim.plan.assumptions,
        timestamp: Date.now(),
      });
    }
  }

  private computeGate(): GateDecision {
    const plan = this.plan;
    if (!plan) throw Object.assign(new Error("no selected plan to evaluate"), { code: "NO_PLAN" });
    return evaluateGate(
      {
        plan,
        currentStateVersion: this.currentStateVersion,
        permission: { granted: ["observe", "recommend", "prepare", "execute-with-approval"], level: AGENT_LEVEL },
        intentContract: this.orchestrator.last?.contract,
        now: Date.now(),
        mutationsSince: this.humanMutations,
      },
      this.policy
    );
  }
}

/** Convert business KPIs into the verification metric shape. */
function metricsOf(kpis: Record<string, unknown>): Record<string, number> {
  const map: Record<string, number> = {
    latency: Number(kpis.checkoutLatencyMs),
    errorRate: Number(kpis.checkoutErrorRate),
    throughput: Number(kpis.ordersThroughputPerSec),
    checkoutSuccess: Number(kpis.checkoutSuccessRate),
    dbLoad: Number(kpis.databaseUtilization),
    cacheHitRate: Number(kpis.cacheHitRateEstimate),
  };
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(map)) {
    if (Number.isFinite(v)) out[k] = v;
  }
  return out;
}
