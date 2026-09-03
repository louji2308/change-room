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

/** V2 tool names are now part of the canonical domain ToolName union. */
export type V2ToolName = "abstain" | "inspect_decision_memory" | "test_robustness";

/** Combined tool name covering all V1 and V2 tools (== ToolName). */
export type WebmcpToolName = ToolName;

/** Enriched context for dynamic tool availability beyond static workflow state. */
export interface ToolContext {
  workflow?: WorkflowState;
  intent?: unknown;
  worldState?: unknown;
  authority?: "L0" | "L1" | "L2" | "L3" | "L4";
  risk?: { overall: "low" | "medium" | "high"; [k: string]: unknown };
  confidence?: Record<string, number>;
  autonomy?: { level: string; [k: string]: unknown };
}

export interface ToolDefinition extends ToolDescriptor {
  name: WebmcpToolName;
  /** Workflow states in which this tool may be invoked. */
  states: WorkflowState[];
  /** Parent group for documentation/organization. */
  group: "observation" | "decision" | "control" | "action" | "verification";
  /**
   * Optional dynamic availability check. When present, a tool is available
   * only when BOTH the static state check AND this function return true.
   * This enables authority/risk/confidence/autonomy gating (§15.1).
   */
  available?: (ctx: ToolContext) => boolean;
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
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    group: "observation",
    states: ["CONTRACT_SET", "INVESTIGATING", "PLAN_READY", "SIMULATED", "WAITING_FOR_APPROVAL", "APPROVED", "EXECUTED", "VERIFYING", "DEVIATION", "RECOVERING", "COMPLETE"],
  },
  {
    name: "investigate",
    description: "Collect structured evidence about the current incident from the observable view. Read-only.",
    inputSchema: { type: "object", properties: { focus: { type: "string", description: "Optional component or metric to focus on" } }, required: [], additionalProperties: false },
    readOnly: true,
    group: "observation",
    states: ["CONTRACT_SET", "INVESTIGATING", "DEVIATION"],
  },
  {
    name: "get_evidence",
    description: "Return previously collected evidence with source, relevance and trust. Read-only.",
    inputSchema: { type: "object", properties: { hypothesisId: { type: "string", description: "Filter evidence by hypothesis" } }, required: [], additionalProperties: false },
    readOnly: true,
    group: "observation",
    states: ["INVESTIGATING", "PLAN_READY", "SIMULATED", "DEVIATION", "COMPLETE"],
  },
  {
    name: "inspect_history",
    description: "Read the auditable event/decision history (flight recorder). Read-only.",
    inputSchema: { type: "object", properties: { limit: { type: "integer", description: "Max events to return" } }, required: [], additionalProperties: false },
    readOnly: true,
    group: "observation",
    states: ["CONTRACT_SET", "INVESTIGATING", "PLAN_READY", "SIMULATED", "WAITING_FOR_APPROVAL", "APPROVED", "EXECUTED", "VERIFYING", "DEVIATION", "RECOVERING", "COMPLETE"],
  },
  {
    name: "generate_plans",
    description: "Generate multiple candidate remediation plans from the current diagnosis. Read-only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    group: "decision",
    states: ["INVESTIGATING", "PLAN_READY", "DEVIATION"],
  },
  {
    name: "compare_plans",
    description: "Compare candidate plans side by side by risk, blast radius, reversibility and confidence. Read-only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    group: "decision",
    states: ["PLAN_READY", "SIMULATED", "DEVIATION"],
  },
  {
    name: "simulate_plan",
    description: "Simulate a plan on an isolated prediction world — never mutates the real sandbox. Read-only.",
    inputSchema: { type: "object", properties: { planId: { type: "string", description: "ID of the plan to simulate" } }, required: ["planId"], additionalProperties: false },
    readOnly: true,
    group: "decision",
    states: ["PLAN_READY", "SIMULATED"],
  },
  {
    name: "challenge_plan",
    description: "Attempt to disprove a plan: surface counterevidence, weak assumptions and failure modes. Read-only.",
    inputSchema: { type: "object", properties: { planId: { type: "string", description: "ID of the plan to challenge" } }, required: ["planId"], additionalProperties: false },
    readOnly: true,
    group: "decision",
    states: ["PLAN_READY", "SIMULATED"],
  },
  {
    name: "prepare_change",
    description: "Prepare a human-readable change request from a plan for approval. Read-only (creates a draft, no mutation yet).",
    inputSchema: { type: "object", properties: { planId: { type: "string", description: "ID of the plan to prepare" } }, required: ["planId"], additionalProperties: false },
    readOnly: true,
    group: "control",
    states: ["SIMULATED", "WAITING_FOR_APPROVAL"],
  },
  {
    name: "validate_policy",
    description: "Check whether a prepared plan is allowed by policy (no mutation). Read-only.",
    inputSchema: { type: "object", properties: { planId: { type: "string", description: "ID of the plan to validate" } }, required: ["planId"], additionalProperties: false },
    readOnly: true,
    group: "control",
    states: ["SIMULATED", "WAITING_FOR_APPROVAL"],
  },
  {
    name: "request_human_decision",
    description: "Request a human decision (approve/reject/modify) for a prepared plan. Read-only at the agent level.",
    inputSchema: { type: "object", properties: { requestId: { type: "string", description: "Change/approval request id" }, ask: { type: "string", description: "What the agent is asking" } }, required: ["requestId", "ask"], additionalProperties: false },
    readOnly: true,
    group: "control",
    states: ["SIMULATED", "WAITING_FOR_APPROVAL", "DEVIATION"],
  },
  {
    name: "execute_change",
    description: "Execute an approved change through the Change Control layer. MUTATES real sandbox state. Requires prior approval authority.",
    inputSchema: { type: "object", properties: { planId: { type: "string", description: "ID of the approved plan to execute" } }, required: ["planId"], additionalProperties: false },
    readOnly: false,
    group: "action",
    states: ["APPROVED"],
  },
  {
    name: "verify_change",
    description: "Verify the actual result of an executed change against the plan's prediction. Read-only.",
    inputSchema: { type: "object", properties: { planId: { type: "string", description: "ID of the executed plan" } }, required: ["planId"], additionalProperties: false },
    readOnly: true,
    group: "verification",
    states: ["EXECUTING", "EXECUTED", "VERIFYING", "DEVIATION", "RECOVERING", "COMPLETE"],
  },
  {
    name: "rollback_change",
    description: "Roll back a change through Change Control. MUTATES real sandbox state; itself a consequential, controlled action.",
    inputSchema: { type: "object", properties: { planId: { type: "string", description: "ID of the plan to roll back" } }, required: ["planId"], additionalProperties: false },
    readOnly: false,
    group: "action",
    states: ["EXECUTED", "DEVIATION", "RECOVERING"],
  },
];

// ── V2 tools (implementation-v2.md §15.2 §15.3) ──────────────────────

export const V2_TOOL_NAMES: V2ToolName[] = [
  "abstain",
  "inspect_decision_memory",
  "test_robustness",
];

const AUTHORITY_RANK: Record<string, number> = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 };

function authoritySufficient(required: "L0" | "L1" | "L2" | "L3" | "L4", ctx: ToolContext): boolean {
  if (!ctx.authority) return true; // no authority context → backward-compatible pass
  return (AUTHORITY_RANK[ctx.authority] ?? 0) >= AUTHORITY_RANK[required];
}

export const V2_TOOLS: ToolDefinition[] = [
  {
    name: "abstain",
    description: "Explicitly abstain from a decision when evidence, robustness, or authority is insufficient. Returns the abstention as a structured AgentDecision.",
    inputSchema: {
      type: "object",
      properties: { reason: { type: "string", description: "Why the agent is abstaining" } },
      required: ["reason"],
      additionalProperties: false,
    },
    readOnly: true,
    group: "decision",
    states: ["CONTRACT_SET", "INVESTIGATING", "PLAN_READY", "SIMULATED", "DEVIATION"],
  },
  {
    name: "inspect_decision_memory",
    description: "Read recent decision-memory record metadata. Returns past decision outcomes, prediction errors, and lessons for context. Read-only.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", description: "Max records to return (default 10)" } },
      required: [],
      additionalProperties: false,
    },
    readOnly: true,
    group: "observation",
    states: ["CONTRACT_SET", "INVESTIGATING", "PLAN_READY", "SIMULATED", "WAITING_FOR_APPROVAL", "APPROVED", "EXECUTED", "VERIFYING", "DEVIATION", "RECOVERING", "COMPLETE"],
  },
  {
    name: "test_robustness",
    description: "Run adversarial robustness challenge against a plan: find failure boundaries, measure resilience, and return structured robustness metrics. Read-only.",
    inputSchema: {
      type: "object",
      properties: { planId: { type: "string", description: "ID of the plan to challenge for robustness" } },
      required: ["planId"],
      additionalProperties: false,
    },
    readOnly: true,
    group: "decision",
    states: ["PLAN_READY", "SIMULATED", "DEVIATION"],
    available: (ctx) => authoritySufficient("L2", ctx),
  },
];

/** Get a tool definition by name. */
export function getTool(name: WebmcpToolName): ToolDefinition | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}

/** Whether a tool is invocable in a given workflow state (static check only). */
export function toolAvailableInState(name: WebmcpToolName, state: WorkflowState): boolean {
  const def = getTool(name);
  if (!def) return false;
  if (V2_TOOL_NAMES.includes(name as V2ToolName)) {
    return def.states.includes(state);
  }
  return canToolInState(state, name as ToolName);
}

/** Combined V1 + V2 tools. */
export const ALL_TOOLS: ToolDefinition[] = [...TOOLS, ...V2_TOOLS];
export const ALL_TOOL_NAMES: WebmcpToolName[] = [...TOOL_NAMES, ...V2_TOOL_NAMES];
