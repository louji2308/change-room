/**
 * Tool definitions (Architecture.md §4; Idea.md §27–28).
 *
 * The Change Room WebMCP surface: a small, distinct set of semantic application
 * capabilities. Tools are state-aware (only available in certain workflow
 * states), read-only tools never mutate, and every mutation passes through the
 * Change Control layer.
 */

import type { ToolDescriptor, ToolName, WorkflowState } from "@change-room/domain";
import { canToolInState } from "@change-room/domain";

export interface ToolDefinition extends ToolDescriptor {
  /** Workflow states in which this tool may be invoked. */
  states: WorkflowState[];
  /** Parent group for documentation/organization. */
  group: "observation" | "decision" | "control" | "action" | "verification";
}

export const TOOL_NAMES: ToolName[] = [
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
];

export const TOOLS: ToolDefinition[] = [
  {
    name: "inspect_system",
    description: "Read the current operational state: health, KPIs and component metrics. Read-only.",
    inputSchema: {},
    readOnly: true,
    group: "observation",
    states: ["CONTRACT_SET", "INVESTIGATING", "PLAN_READY", "SIMULATED", "WAITING_FOR_APPROVAL", "APPROVED", "EXECUTED", "VERIFYING", "DEVIATION", "RECOVERING", "COMPLETE"],
  },
  {
    name: "investigate",
    description: "Collect structured evidence about the current incident from the observable view. Read-only.",
    inputSchema: { focus: { type: "string", description: "Optional component or metric to focus on", required: false } },
    readOnly: true,
    group: "observation",
    states: ["CONTRACT_SET", "INVESTIGATING", "DEVIATION"],
  },
  {
    name: "get_evidence",
    description: "Return previously collected evidence with source, relevance and trust. Read-only.",
    inputSchema: { hypothesisId: { type: "string", description: "Filter evidence by hypothesis", required: false } },
    readOnly: true,
    group: "observation",
    states: ["INVESTIGATING", "PLAN_READY", "SIMULATED", "DEVIATION", "COMPLETE"],
  },
  {
    name: "inspect_history",
    description: "Read the auditable event/decision history (flight recorder). Read-only.",
    inputSchema: { limit: { type: "integer", description: "Max events to return", required: false } },
    readOnly: true,
    group: "observation",
    states: ["CONTRACT_SET", "INVESTIGATING", "PLAN_READY", "SIMULATED", "WAITING_FOR_APPROVAL", "APPROVED", "EXECUTED", "VERIFYING", "DEVIATION", "RECOVERING", "COMPLETE"],
  },
  {
    name: "generate_plans",
    description: "Generate multiple candidate remediation plans from the current diagnosis. Read-only.",
    inputSchema: {},
    readOnly: true,
    group: "decision",
    states: ["INVESTIGATING", "PLAN_READY", "DEVIATION"],
  },
  {
    name: "compare_plans",
    description: "Compare candidate plans side by side by risk, blast radius, reversibility and confidence. Read-only.",
    inputSchema: {},
    readOnly: true,
    group: "decision",
    states: ["PLAN_READY", "SIMULATED", "DEVIATION"],
  },
  {
    name: "simulate_plan",
    description: "Simulate a plan on an isolated prediction world — never mutates the real sandbox. Read-only.",
    inputSchema: { planId: { type: "string", description: "ID of the plan to simulate", required: true } },
    readOnly: true,
    group: "decision",
    states: ["PLAN_READY", "SIMULATED"],
  },
  {
    name: "challenge_plan",
    description: "Attempt to disprove a plan: surface counterevidence, weak assumptions and failure modes. Read-only.",
    inputSchema: { planId: { type: "string", description: "ID of the plan to challenge", required: true } },
    readOnly: true,
    group: "decision",
    states: ["PLAN_READY", "SIMULATED"],
  },
  {
    name: "prepare_change",
    description: "Prepare a human-readable change request from a plan for approval. Read-only (creates a draft, no mutation yet).",
    inputSchema: { planId: { type: "string", description: "ID of the plan to prepare", required: true } },
    readOnly: true,
    group: "control",
    states: ["SIMULATED", "WAITING_FOR_APPROVAL"],
  },
  {
    name: "validate_policy",
    description: "Check whether a prepared plan is allowed by policy (no mutation). Read-only.",
    inputSchema: { planId: { type: "string", description: "ID of the plan to validate", required: true } },
    readOnly: true,
    group: "control",
    states: ["SIMULATED", "WAITING_FOR_APPROVAL"],
  },
  {
    name: "request_human_decision",
    description: "Request a human decision (approve/reject/modify) for a prepared plan. Read-only at the agent level.",
    inputSchema: { requestId: { type: "string", description: "Change/approval request id", required: true }, ask: { type: "string", description: "What the agent is asking", required: true } },
    readOnly: true,
    group: "control",
    states: ["SIMULATED", "WAITING_FOR_APPROVAL", "DEVIATION"],
  },
  {
    name: "execute_change",
    description: "Execute an approved change through the Change Control layer. MUTATES real sandbox state. Requires prior approval authority.",
    inputSchema: { planId: { type: "string", description: "ID of the approved plan to execute", required: true } },
    readOnly: false,
    group: "action",
    states: ["APPROVED"],
  },
  {
    name: "verify_change",
    description: "Verify the actual result of an executed change against the plan's prediction. Read-only.",
    inputSchema: { planId: { type: "string", description: "ID of the executed plan", required: true } },
    readOnly: true,
    group: "verification",
    states: ["EXECUTING", "EXECUTED", "VERIFYING", "DEVIATION", "RECOVERING", "COMPLETE"],
  },
  {
    name: "rollback_change",
    description: "Roll back a change through Change Control. MUTATES real sandbox state; itself a consequential, controlled action.",
    inputSchema: { planId: { type: "string", description: "ID of the plan to roll back", required: true } },
    readOnly: false,
    group: "action",
    states: ["EXECUTED", "DEVIATION", "RECOVERING"],
  },
];

/** Get a tool definition by name. */
export function getTool(name: ToolName): ToolDefinition | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** Whether a tool is invocable in a given workflow state. */
export function toolAvailableInState(name: ToolName, state: WorkflowState): boolean {
  const def = getTool(name);
  if (!def) return false;
  return canToolInState(state, name);
}
