/**
 * Simulation coordinator (Implementation.md §6.5).
 *
 * The agent sends candidate plans to the Prediction World (an isolated clone)
 * and collects predicted outcomes per plan. It NEVER mutates the real world —
 * prediction is strictly on the isolated branch.
 */

import type { Plan } from "@change-room/domain";
import type { WorldSimulator, ActionType, PredictionResult } from "@change-room/simulator";
import { createAction } from "@change-room/simulator";

export interface SimulatedPlan {
  plan: Plan;
  actionType: ActionType;
  parameters: Record<string, number | string>;
  prediction: PredictionResult | null;
  error?: string;
  /** Predicted end-state KPIs as a flat metric map. */
  predictedKpis: Record<string, number>;
}

/**
 * Run every action of a plan as a prediction on an isolated branch of the
 * simulator. Returns the predicted outcome for each action. Does not touch the
 * executor's live state.
 */
export function simulatePlan(sim: WorldSimulator, plan: Plan): SimulatedPlan[] {
  return plan.actions.map((act) => {
    const actionType = act.type as ActionType;
    try {
      const action = createAction(actionType, act.parameters ?? {});
      const prediction = sim.predict(action, { horizonTicks: 30 });
      return {
        plan,
        actionType,
        parameters: act.parameters ?? {},
        prediction,
        predictedKpis: prediction.ok ? flattenKpis(prediction) : {},
      };
    } catch (err) {
      return {
        plan,
        actionType,
        parameters: act.parameters ?? {},
        prediction: null,
        error: err instanceof Error ? err.message : String(err),
        predictedKpis: {},
      };
    }
  });
}

function flattenKpis(p: PredictionResult): Record<string, number> {
  return {
    checkoutLatencyMs: p.kpis.checkoutLatencyMs,
    checkoutErrorRate: p.kpis.checkoutErrorRate,
    checkoutSuccessRate: p.kpis.checkoutSuccessRate,
    ordersThroughputPerSec: p.kpis.ordersThroughputPerSec,
    cacheHitRateEstimate: p.kpis.cacheHitRateEstimate,
  };
}
