/**
 * Change Room — security hardening utilities (Implementation.md §15).
 *
 * Provides untrusted-content classification, strict input validation and
 * prompt-injection resistance. Untrusted text (logs, external content, user
 * content, agent output) is always treated as DATA, never as instructions.
 */

export type ContentClass =
  | "trusted_system"
  | "user"
  | "external"
  | "agent_generated";

/**
 * Classify a raw string by its trust origin (Implementation.md §15.1).
 *
 * - trusted_system: produced by the Change Room runtime itself (state view,
 *   gate decisions, schema-driven results).
 * - user: authored/typed directly by the human operator.
 * - external: any content that entered the system from outside (logs, tickets,
 *   vendor feeds, network payloads). Maximally untrusted.
 * - agent_generated: produced by the agent model; still untrusted — never
 *   executed as instructions.
 *
 * The classifier is pure and never inspects the semantic *meaning* of the
 * content — it only assigns a trust class based on origin.
 */
export function classifyContent(raw: string, origin: ContentClass = "external"): ContentClass {
  return origin;
}

/**
 * True when a class is safe to treat as directives. Only `trusted_system` may
 * ever influence control flow; everything else must be treated as inert data.
 */
export function isTrustedAsInstruction(cls: ContentClass): boolean {
  return cls === "trusted_system";
}

/** Whether a class is considered untrusted input (must never become an instruction). */
export function isUntrusted(cls: ContentClass): boolean {
  return cls === "external" || cls === "user" || cls === "agent_generated";
}

/**
 * Known set of tool/action type enums, used to reject invalid enum values in
 * strict input validation (Implementation.md §15.3).
 */
export const ACTION_TYPE_ENUM: readonly string[] = [
  "increase_cache_capacity",
  "restart_cache",
  "scale_service",
  "scale_database",
  "rollback_deployment",
  "change_configuration",
  "restore_configuration",
  "do_nothing",
];

export const ACTOR_ENUM: readonly string[] = ["human", "agent", "system", "automation"];

/** Ranges enforced for numeric plan parameters (out-of-range rejection). */
export const PARAM_RANGES: Record<string, { min: number; max: number }> = {
  factor: { min: 0.1, max: 10 },
  newCapacityGB: { min: 1, max: 512 },
  value: { min: 0, max: 100000 },
};

/**
 * Validate that a string is a plausible, well-formed internal ID (planId,
 * requestId, hypothesisId). Prevents injection of arbitrary/malformed values.
 */
export function isValidId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

/**
 * Strictly validate a plan-id-style argument. Returns an error message if
 * invalid, or null when acceptable. Missing/empty/non-string/out-of-shape
 * values are rejected.
 */
export function validateIdField(field: string, value: unknown): string | null {
  if (value === undefined || value === null) {
    return `missing required field '${field}'`;
  }
  if (typeof value !== "string") {
    return `field '${field}' must be a string`;
  }
  if (!isValidId(value)) {
    return `field '${field}' is not a valid id`;
  }
  return null;
}

/**
 * Strictly validate an action-type enum value. Rejects anything not in the
 * known enum (Implementation.md §15.3: reject invalid enums).
 */
export function validateActionType(value: unknown): string | null {
  if (typeof value !== "string") {
    return "actionType must be a string";
  }
  if (!ACTION_TYPE_ENUM.includes(value)) {
    return `actionType '${value}' is not a known action type`;
  }
  return null;
}

/**
 * Validate an actor enum value.
 */
export function validateActor(value: unknown): string | null {
  if (typeof value !== "string") {
    return "actor must be a string";
  }
  if (!ACTOR_ENUM.includes(value)) {
    return `actor '${value}' is not a known actor`;
  }
  return null;
}

/**
 * Validate a numeric parameter against the known range for its name. Returns
 * an error string or null when acceptable.
 */
export function validateParamInRange(name: string, value: unknown): string | null {
  const range = PARAM_RANGES[name];
  if (typeof value !== "number") {
    return `parameter '${name}' must be a number`;
  }
  if (range) {
    if (value < range.min || value > range.max) {
      return `parameter '${name}' (${value}) is out of range [${range.min}, ${range.max}]`;
    }
  }
  return null;
}
