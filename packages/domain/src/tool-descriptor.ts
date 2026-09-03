/**
 * Tool descriptor (WebMCP layer contract; Idea.md §28).
 *
 * A WebMCP tool is a semantic application capability with a name, description,
 * input schema, whether it is read-only, and which workflow states permit it.
 * The application owns execution via a `run` implementation.
 */

export type ToolName =
  | "inspect_system"
  | "investigate"
  | "get_evidence"
  | "inspect_history"
  | "generate_plans"
  | "compare_plans"
  | "simulate_plan"
  | "challenge_plan"
  | "test_robustness"
  | "abstain"
  | "inspect_decision_memory"
  | "prepare_change"
  | "validate_policy"
  | "request_human_decision"
  | "execute_change"
  | "verify_change"
  | "rollback_change";

export interface JsonSchemaField {
  type: "string" | "number" | "boolean" | "integer" | "array" | "object";
  description?: string;
  enum?: string[];
  required?: boolean;
}

export interface JsonSchemaObject {
  type: "object";
  properties: Record<string, JsonSchemaField>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDescriptor {
  name: ToolName;
  description: string;
  /** JSON-schema style input spec — a valid JSON Schema object with type "object". */
  inputSchema: JsonSchemaObject;
  /** Read-only tools never mutate state. */
  readOnly: boolean;
}
