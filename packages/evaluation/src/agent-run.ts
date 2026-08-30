/**
 * Agent-driven blind evaluation run (Phase 16).
 *
 * Runs one scenario end to end with the real agent as operator, the control
 * layer as the policy gate, and the core harness collecting the full
 * Phase-16 metric set.
 */

import type { PolicyRule } from "@change-room/control";
import type { BlindRun, RunOptions } from "@change-room/scenarios";
import { runBlindSession } from "@change-room/scenarios";
import { createAgentOperator } from "./agent-operator.js";
import { createPolicyCheck } from "./policy-check.js";

export interface AgentEvaluationOptions {
  scenarioId: string;
  incidentSeconds?: number;
  settleAfterAction?: number;
  maxActions?: number;
  predictHorizon?: number;
  goal?: string;
  /** Optional policy rules; when omitted the default permissive surface is used. */
  policyRules?: PolicyRule[];
  /** Also fire one deliberately invalid call to prove rejection is counted. */
  probeInvalidCall?: boolean;
}

export function runAgentEvaluation(opts: AgentEvaluationOptions): BlindRun {
  const { policyRules, goal, incidentSeconds, settleAfterAction, maxActions, predictHorizon, probeInvalidCall } = opts;
  const options: RunOptions = {
    scenarioId: opts.scenarioId,
    incidentSeconds,
    settleAfterAction,
    maxActions,
    predictHorizon,
    probeInvalidCall,
    operatorFactory: (runner) => createAgentOperator(runner, goal),
    policyCheck: policyRules && policyRules.length > 0 ? createPolicyCheck(policyRules) : undefined,
  };
  const run = runBlindSession(options);
  return run;
}