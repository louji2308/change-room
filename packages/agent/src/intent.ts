/**
 * Intent parser (Implementation.md §6.1; Idea.md §20).
 *
 * Converts the human's natural-language goal + constraints into a structured
 * IntentContract (goal, priorities, constraints, forbidden, authority). This is
 * a deterministic, keyword-driven parser — the agent reasons under the contract
 * and the contract never silently expands authority.
 */

import { createIntentContract, type IntentContract, type Priority } from "@change-room/domain";

const PRIORITY_KEYWORDS: Array<{ priority: Priority; words: string[] }> = [
  { priority: "availability", words: ["availability", "recover", "restore", "available", "sla", "uptime", "checkout working"] },
  { priority: "safety", words: ["safely", "safety", "without risk", "careful"] },
  { priority: "latency", words: ["latency", "speed", "fast", "slow", "performance"] },
  { priority: "cost", words: ["cost", "expensive", "cheap", "efficient", "budget"] },
  { priority: "throughput", words: ["throughput", "capacity", "scale", "load"] },
];

const CONSTRAINT_PATTERNS: Array<{ pattern: RegExp; constraint: (m: RegExpMatchArray) => string }> = [
  {
    pattern: /(?:do not|don't|never|without)\s+([^.]*?)\s+without\s+my\s+approval/i,
    constraint: (m) => `no ${m[1].trim()} without my approval`,
  },
  {
    pattern: /no\s+production\s+(?:changes?|deploys?)/i,
    constraint: () => "no production change without approval",
  },
  {
    pattern: /(?:do not|don't|never|no)\s+([^.]+)/i,
    constraint: (m) => `avoid ${m[1].trim().toLowerCase()}`,
  },
];

const FORBIDDEN_KEYWORDS: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /schema/i, value: "database schema changes" },
  { pattern: /production/i, value: "production changes without approval" },
  { pattern: /delete/i, value: "deletion of data" },
  { pattern: /irreversible/i, value: "irreversible actions" },
];

/**
 * Map intent keywords to machine-readable action types / resources so the
 * policy engine can enforce the human's constraints against real action
 * identifiers (P0-4). The natural-language `forbidden` list is retained only
 * for display/provenance.
 */
function structuredForbidden(goal: string): {
  forbiddenActionTypes: string[];
  forbiddenResources: string[];
} {
  const forbiddenActionTypes: string[] = [];
  const forbiddenResources: string[] = [];

  // "schema" → no database/configuration mutation.
  if (/schema/i.test(goal)) forbiddenResources.push("database", "schema", "configuration");
  // "no production changes" → forbid deployment/config rollouts.
  if (/production/i.test(goal)) forbiddenActionTypes.push("rollback_deployment", "change_configuration");
  // "delete" → no data deletion.
  if (/delete/i.test(goal)) forbiddenResources.push("inventory");
  // "irreversible" → no irreversible mutation types.
  if (/irreversible/i.test(goal)) forbiddenActionTypes.push("rollback_deployment", "scale_database", "change_configuration");

  return { forbiddenActionTypes, forbiddenResources };
}

/** Parse a human goal statement into a structured intent contract. */
export function parseIntent(goal: string, extra?: Partial<Pick<IntentContract, "defaultAuthority" | "author">>): IntentContract {
  const priorities: Priority[] = [];
  for (const { priority, words } of PRIORITY_KEYWORDS) {
    if (words.some((w) => goal.toLowerCase().includes(w))) priorities.push(priority);
  }
  if (priorities.length === 0) priorities.push("availability");

  const constraints: string[] = [];
  for (const { pattern, constraint } of CONSTRAINT_PATTERNS) {
    const m = goal.match(pattern);
    if (m && m[1]) constraints.push(constraint(m));
  }

  const forbidden = FORBIDDEN_KEYWORDS.filter((f) => f.pattern.test(goal)).map((f) => f.value);
  const { forbiddenActionTypes, forbiddenResources } = structuredForbidden(goal);

  // A goal that asks to "restore safely" but forbids nothing defaults to low
  // authority; explicit safety language keeps authority low.
  const defaultAuthority = goal.toLowerCase().includes("safely") ? "L0" : (extra?.defaultAuthority ?? "L2");

  return createIntentContract({
    goal,
    priorities,
    constraints,
    forbidden,
    forbiddenActionTypes,
    forbiddenResources,
    defaultAuthority,
    author: extra?.author ?? "human",
  });
}
