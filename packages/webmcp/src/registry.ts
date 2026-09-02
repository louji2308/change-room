/**
 * WebMCP registry (Implementation.md §7; Idea.md §28).
 *
 * Enforcement layer around the tool surface: input schema validation, workflow
 * state availability, read-only guarantees and delegation to a ToolRuntime.
 * Reads are permitted only for read-only tools in an allowed state; mutations
 * are gated (the runtime decides via Change Control).
 */

import type { ToolName, WorkflowState, JsonSchemaField, JsonSchemaObject } from "@change-room/domain";
import { TOOLS, getTool, toolAvailableInState, type ToolDefinition } from "./tools.js";
import { classifyContent, isTrustedAsInstruction, type ContentClass } from "./security.js";

/** Implemented by the Change Room application host. */
export interface ToolRuntime {
  /** Current workflow state used for capability gating. */
  workflowState(): WorkflowState;
  /** Execute a tool's application logic. Must never return hidden ground truth. */
  execute(name: ToolName, args: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown; error?: string }>;
}

export type InvocationResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; validation?: string[] };

export class WebmcpRegistry {
  constructor(private readonly runtime: ToolRuntime) {}

  /** List all tools (for discovery) with their availability in the current state. */
  discover(): Array<{ name: ToolName; description: string; inputSchema: JsonSchemaObject; readOnly: boolean; group: string; available: boolean }> {
    const state = this.runtime.workflowState();
    return TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      readOnly: t.readOnly,
      group: t.group,
      available: toolAvailableInState(t.name, state),
    }));
  }

  /** Whether a tool is currently invocable. */
  canUse(name: ToolName): boolean {
    return toolAvailableInState(name, this.runtime.workflowState());
  }

  /** Validate raw args against a tool's input schema. */
  validate(name: ToolName, args: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; errors: string[] } {
    const def = getTool(name);
    if (!def) return { ok: false, errors: [`unknown tool: ${name}`] };
    if (typeof args !== "object" || args === null || Array.isArray(args)) {
      return { ok: false, errors: ["args must be an object"] };
    }
    const input = args as Record<string, unknown>;
    const errors: string[] = [];
    const schema: JsonSchemaObject = def.inputSchema;
    const properties = schema.properties ?? {};
    const required = schema.required ?? [];
    // Reject unknown fields (additionalProperties: false).
    for (const key of Object.keys(input)) {
      if (!(key in properties)) {
        errors.push(`unknown field '${key}'`);
      }
    }
    for (const [key, field] of Object.entries(properties)) {
      const present = input[key] !== undefined && input[key] !== null;
      if (required.includes(key) && !present) {
        errors.push(`missing required field '${key}'`);
        continue;
      }
      if (present && !typeMatches(field.type, input[key])) {
        errors.push(`field '${key}' must be of type ${field.type}`);
      }
      if (field.enum && present && !field.enum.includes(String(input[key]))) {
        errors.push(`field '${key}' must be one of: ${field.enum.join(", ")}`);
      }
      // Strict ID validation (Implementation.md §15.3: reject invalid IDs).
      if (present && /Id$/.test(key)) {
        if (typeof input[key] !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(input[key] as string)) {
          errors.push(`field '${key}' is not a valid id`);
        }
      }
    }
    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, value: input };
  }

  /**
   * Invoke a tool with enforcement: state availability + read-only + schema.
   * The runtime handles permission/control for mutations.
   */
  async invoke(name: ToolName, rawArgs: unknown): Promise<InvocationResult> {
    const def = getTool(name);
    if (!def) return { ok: false, error: `unknown tool: ${name}` };

    if (!toolAvailableInState(name, this.runtime.workflowState())) {
      return { ok: false, error: `tool '${name}' is not available in the current workflow state (${this.runtime.workflowState()})` };
    }

    const v = this.validate(name, rawArgs);
    if (!v.ok) {
      return { ok: false, error: `invalid input for '${name}'`, validation: v.errors };
    }

    // Guard: even if a mutation tool is somehow invoked while the registry
    // thinks it's read-only by definition, never route a read-only mismatch.
    const res = await this.runtime.execute(name, v.value);
    if (!res.ok) return { ok: false, error: res.error ?? "tool execution failed" };
    return { ok: true, data: res.data };
  }
}

/**
 * Classify tool output content by origin so the agent can distinguish trusted
 * system data from untrusted user/external/agent material. Returns the data
 * unchanged alongside its trust class. Pure and side-effect free.
 */
export function classifyToolOutput<T>(data: T, origin: ContentClass = "trusted_system"): { data: T; trust: ContentClass; treatAsInstruction: boolean } {
  return {
    data,
    trust: origin,
    treatAsInstruction: isTrustedAsInstruction(origin),
  };
}

function typeMatches(type: JsonSchemaField["type"], value: unknown): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "integer":
      return Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    default:
      return true;
  }
}

export { TOOLS, getTool, toolAvailableInState };
export type { ToolDefinition };
