/**
 * Agent-driven blind operator (Phase 16 evaluation).
 *
 * Wraps the real `AgentOrchestrator` reasoning pipeline (intent → investigate →
 * hypotheses → plans → simulation) as the `BlindOperator` the core harness
 * expects. Each observation triggers a full reasoning cycle; the operator then
 * picks the action whose faithful remediation prediction improves checkout the
 * most. It never reads `groundTruth()`.
 */

import type { ActionType, WorldSimulator } from "@change-room/simulator";
import { AgentOrchestrator, type SimulatedPlan } from "@change-room/agent";
import type {
  AgentView,
  BlindOperator,
  OperatorDecision,
  ScenarioRunner,
} from "@change-room/scenarios";

const DEFAULT_GOAL =
  "Resolve the current incident: restore checkout to a healthy state without changing demand";

/** The agent's cause label; aligned with the scenario suite's cause vocabulary. */
export function createAgentOperator(
  runner: ScenarioRunner,
  goal = DEFAULT_GOAL
): BlindOperator {
  const orchestrator = new AgentOrchestrator({
    sim: runner as unknown as WorldSimulator,
    currentStateVersion: () => Math.round(runner.agentView().timestamp),
  });

  return (view: AgentView, ctx: { attempt: number }): OperatorDecision => {
    const result = orchestrator.reason(goal, view);
    const top = result.topHypothesis;
    const cause = top?.cause;
    const trace: Record<string, unknown> = {
      goal,
      hypotheses: result.hypotheses.map((h) => ({
        cause: h.cause,
        confidence: Math.round(h.confidence * 100) / 100,
        status: h.status,
      })),
      plans: result.plans.map((p) => p.name),
      attempt: ctx.attempt,
    };

    // Rank simulated plans by predicted checkout error rate (then latency).
    const observedErr = Number(view.kpis.checkoutErrorRate ?? 0);
    let best: SimulatedPlan | null = null;
    let bestErr = Infinity;
    let bestLat = Infinity;
    for (const s of result.simulations) {
      if (!s.prediction?.ok) continue;
      const err = Number(s.prediction.kpis.checkoutErrorRate ?? Infinity);
      const lat = Number(s.prediction.kpis.checkoutLatencyMs ?? Infinity);
      if (err < bestErr || (err === bestErr && lat < bestLat)) {
        bestErr = err;
        bestLat = lat;
        best = s;
      }
    }

    if (best && best.prediction && bestErr < observedErr) {
      const act = best.plan.actions[0];
      trace.chosenPlan = best.plan.name;
      trace.predictedError = bestErr;
      return {
        action: { type: act.type as ActionType, parameters: act.parameters ?? {} },
        cause,
        reason: `plan '${best.plan.name}' predicts checkout error ${bestErr.toFixed(1)}% (observed ${observedErr.toFixed(1)}%)`,
        trace,
      };
    }

    return {
      stop: true,
      cause,
      reason: `no simulated plan improves checkout error below the observed ${observedErr.toFixed(1)}%`,
      trace,
    };
  };
}