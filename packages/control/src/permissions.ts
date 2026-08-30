/**
 * Permission engine (Implementation.md §5.3; Idea.md §40).
 *
 * Defines the capability levels an account/session holds (observe, recommend,
 * prepare, execute-with-approval, limited-autonomous) and checks whether a tool
 * use is within the granted permission set.
 */

import { canCapability, type AuthorityLevel } from "@change-room/domain";

export interface PermissionContext {
  /** Capabilities this operator session has been granted. */
  granted: string[];
  /** Highest authority level held. */
  level: AuthorityLevel;
}

export type PermissionResult =
  | { ok: true; reason: string }
  | { ok: false; reason: string; required: string[] };

/**
 * Translate a requested tool/capability into the authority capability groups
 * that grant it. If the requested name is itself a canonical capability group
 * (observe/recommend/prepare/execute-with-approval/limited-autonomous) we check
 * it directly; otherwise we map from the tool name.
 */
const DIRECT_CAPS = new Set(["observe", "recommend", "prepare", "execute-with-approval", "limited-autonomous"]);

const TOOL_CAP_REQUIREMENT: Record<string, string[]> = {
  observe: [],
  inspect_system: ["observe"],
  investigate: ["observe"],
  get_evidence: ["observe"],
  inspect_history: ["observe"],
  generate_plans: ["recommend"],
  compare_plans: ["recommend"],
  simulate_plan: ["recommend"],
  challenge_plan: ["recommend"],
  prepare_change: ["prepare"],
  validate_policy: ["prepare"],
  request_human_decision: ["recommend"],
  execute_change: ["execute-with-approval", "limited-autonomous"],
  verify_change: ["execute-with-approval", "limited-autonomous"],
  rollback_change: ["execute-with-approval", "limited-autonomous"],
};

export function checkPermission(ctx: PermissionContext, capability: string): PermissionResult {
  let required: string[];
  if (DIRECT_CAPS.has(capability)) {
    required = [capability];
  } else {
    required = TOOL_CAP_REQUIREMENT[capability] ?? [capability];
  }

  for (const group of required) {
    if (canCapability(ctx.level, group)) {
      return { ok: true, reason: `capability '${capability}' granted at ${ctx.level}` };
    }
  }
  return { ok: false, reason: `capability '${capability}' not granted at ${ctx.level}`, required };
}
