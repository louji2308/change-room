/**
 * Authority model (Idea.md §25, Architecture.md §22).
 *
 * Progressive autonomy: the agent's allowed capability scales with risk,
 * confidence, blast radius, reversibility, policy and state freshness.
 * Authority is earned by context, never globally enabled.
 */

export type AuthorityLevel = "L0" | "L1" | "L2" | "L3" | "L4";

export const AUTHORITY_RANK: Record<AuthorityLevel, number> = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 };

export interface OperationAuthority {
  level: AuthorityLevel;
  /** Rank so callers can compare levels. */
  rank: number;
  /** What operations this level permits. */
  capabilities: string[];
  /** Human approval still required at this level? */
  approvalRequired: boolean;
}

export const AUTHORITY: Record<AuthorityLevel, OperationAuthority> = {
  L0: {
    level: "L0",
    rank: 0,
    capabilities: ["observe"],
    approvalRequired: true,
  },
  L1: {
    level: "L1",
    rank: 1,
    capabilities: ["observe", "recommend"],
    approvalRequired: true,
  },
  L2: {
    level: "L2",
    rank: 2,
    capabilities: ["observe", "recommend", "prepare"],
    approvalRequired: true,
  },
  L3: {
    level: "L3",
    rank: 3,
    capabilities: ["observe", "recommend", "prepare", "execute-with-approval"],
    approvalRequired: true,
  },
  L4: {
    level: "L4",
    rank: 4,
    capabilities: ["observe", "recommend", "prepare", "execute-with-approval", "limited-autonomous"],
    approvalRequired: false,
  },
};

/** Would a given capability be available at some authority level? */
export function canCapability(level: AuthorityLevel, capability: string): boolean {
  return AUTHORITY[level].capabilities.includes(capability);
}

export function rankOf(level: AuthorityLevel): number {
  return AUTHORITY_RANK[level];
}
