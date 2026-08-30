/**
 * Workflow state machine (Architecture.md §20; Idea.md §27).
 *
 * The shared workflow the human and agent advance through. The available
 * capability surface follows this state: the agent can only invoke tools that
 * the current state permits.
 */

export type WorkflowState =
  | "IDLE"
  | "CONTRACT_SET"
  | "INVESTIGATING"
  | "PLAN_READY"
  | "SIMULATED"
  | "WAITING_FOR_APPROVAL"
  | "APPROVED"
  | "EXECUTING"
  | "EXECUTED"
  | "VERIFYING"
  | "DEVIATION"
  | "RECOVERING"
  | "COMPLETE";

export const WORKFLOW_ORDER: WorkflowState[] = [
  "IDLE",
  "CONTRACT_SET",
  "INVESTIGATING",
  "PLAN_READY",
  "SIMULATED",
  "WAITING_FOR_APPROVAL",
  "APPROVED",
  "EXECUTING",
  "EXECUTED",
  "VERIFYING",
  "DEVIATION",
  "RECOVERING",
  "COMPLETE",
];

export interface WorkflowStatus {
  state: WorkflowState;
  /** Which capability is available in the current state. */
  available: string[];
  /** Human-readable status label for the UI. */
  label: string;
}

const AVAILABLE_BY_STATE: Record<WorkflowState, string[]> = {
  IDLE: [],
  CONTRACT_SET: ["inspect_system", "investigate"],
  INVESTIGATING: ["inspect_system", "investigate", "get_evidence", "inspect_history", "generate_plans"],
  PLAN_READY: ["generate_plans", "compare_plans", "simulate_plan", "challenge_plan"],
  SIMULATED: ["compare_plans", "simulate_plan", "challenge_plan", "prepare_change", "validate_policy"],
  WAITING_FOR_APPROVAL: ["request_human_decision", "validate_policy", "prepare_change"],
  APPROVED: ["execute_change"],
  EXECUTING: ["verify_change"],
  EXECUTED: ["verify_change", "rollback_change"],
  VERIFYING: ["verify_change", "rollback_change"],
  DEVIATION: ["investigate", "generate_plans", "rollback_change", "request_human_decision"],
  RECOVERING: ["verify_change", "rollback_change"],
  COMPLETE: ["verify_change", "inspect_history"],
};

export function workflowStatus(state: WorkflowState): WorkflowStatus {
  return { state, available: AVAILABLE_BY_STATE[state], label: humanLabel(state) };
}

export function humanLabel(state: WorkflowState): string {
  const map: Record<WorkflowState, string> = {
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
  return map[state];
}

export function canToolInState(state: WorkflowState, tool: string): boolean {
  return AVAILABLE_BY_STATE[state].includes(tool);
}
