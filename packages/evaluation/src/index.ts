/**
 * Change Room — Phase 16 evaluation package.
 *
 * Bridges the plain, dependency-free blind harness in `@change-room/scenarios`
 * to the real agent reasoning pipeline and the control layer, and exposes a
 * one-call evaluation entry for running and scoring the scenario suite.
 */

export { runAgentEvaluation, type AgentEvaluationOptions } from "./agent-run.js";
export { createAgentOperator } from "./agent-operator.js";
export { createPolicyCheck, defaultPolicyCheck, type PolicyCheck } from "./policy-check.js";

export type {
  BlindRun,
  RunOptions,
  EvaluationMetrics,
  OperatorAction,
  OperatorDecision,
  BlindOperator,
  Metric,
  PolicyVerdict,
  Health,
  MetricStatus,
  OperatorCall,
} from "@change-room/scenarios";

export type { PolicyRule } from "@change-room/control";