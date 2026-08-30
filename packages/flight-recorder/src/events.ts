/**
 * Change Room — flight event definitions (Phase 11).
 *
 * The atom of the flight recorder: an immutable, appended-only record of some
 * point in the human+agent operational lifecycle. Every event carries an
 * actor, a type and a monotonic sequence number. Sensitive secrets are stripped
 * before storage so they never reach the log.
 */

export type Actor = "human" | "agent" | "system" | "automation";

export type ChangeRoomEventType =
  | "intent_contract_set"
  | "observation"
  | "evidence_added"
  | "hypothesis_added"
  | "hypothesis_updated"
  | "plan_generated"
  | "plan_status_changed"
  | "simulation_requested"
  | "policy_checked"
  | "approval_requested"
  | "human_approved"
  | "human_rejected"
  | "execution_started"
  | "execution_completed"
  | "verification"
  | "rollback"
  | "recovery"
  | "agent_paused"
  | "agent_resumed"
  | "human_takeover"
  | "delegation_granted"
  | "delegation_expired"
  | "incident_complete";

export interface ChangeRoomEvent {
  seq: number;
  timestamp: number;
  actor: Actor;
  type: ChangeRoomEventType;
  stateVersion?: number;
  planId?: string;
  tool?: string;
  inputSummary?: string;
  resultSummary?: string;
  detail?: Record<string, unknown>;
}

const SENSITIVE_FIELDS: readonly string[] = [
  "secret",
  "password",
  "token",
  "apiKey",
  "credential",
];

/**
 * Returns a copy of `detail` with any sensitive fields removed (case-insensitive).
 * Never mutates the caller's object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function redacted(detail?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!detail) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (SENSITIVE_FIELDS.some((f) => f.toLowerCase() === key.toLowerCase())) {
      continue;
    }
    out[key] = value;
  }
  return out;
}
