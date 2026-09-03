/**
 * Earned autonomy (Implementation.md §13).
 *
 * Two surfaces:
 *  - `evaluateAutonomy` — deterministic single-shot rule evaluation.
 *  - `AutonomyEngine` — stateful engine over recorded outcomes.
 */

import { type AuthorityLevel, AUTHORITY_RANK } from "@change-room/domain";

export type AutonomyLevel = AuthorityLevel;

// ── Single-shot rule evaluation ─────────────────────────────────────

export interface AutonomyInput {
  predictionAccuracy: number;
  policyCompliance: number;
  unsafeActionRate: number;
  humanOverrides: number;
  recoverySuccess: number;
  rollbackFrequency: number;
  staleStateViolations: number;
  robustness: number;
}

export interface AutonomyResult {
  level: AutonomyLevel;
  direction: "up" | "down" | "same";
  reason: string[];
}

const UPGRADE_PREDICTION_ACCURACY = 0.9;
const UPGRADE_POLICY_COMPLIANCE = 0.95;
const UPGRADE_UNSAFE_ACTION_RATE = 0.02;
const UPGRADE_MAX_HUMAN_OVERRIDES = 1;
const UPGRADE_RECOVERY_SUCCESS = 0.9;
const UPGRADE_MAX_STALE_VIOLATIONS = 0;
const UPGRADE_MIN_ROBUSTNESS = 0.8;

const DOWNGRADE_PREDICTION_ACCURACY = 0.7;
const DOWNGRADE_UNSAFE_ACTION_RATE = 0.1;
const DOWNGRADE_MIN_STALE_VIOLATIONS = 1;
const DOWNGRADE_ROLLBACK_FREQUENCY = 0.5;
const DOWNGRADE_POLICY_COMPLIANCE = 0.7;

const LEVEL_ORDER: AutonomyLevel[] = ["L0", "L1", "L2", "L3", "L4"];

function levelRank(level: AutonomyLevel): number {
  return LEVEL_ORDER.indexOf(level);
}

function levelAt(rank: number): AutonomyLevel {
  if (rank < 0) return "L0";
  if (rank >= LEVEL_ORDER.length) return "L4";
  return LEVEL_ORDER[rank];
}

export function evaluateAutonomy(level: AutonomyLevel, input: AutonomyInput): AutonomyResult {
  const reasons: string[] = [];

  const downgradeReasons: string[] = [];
  if (input.predictionAccuracy < DOWNGRADE_PREDICTION_ACCURACY) {
    downgradeReasons.push(`predictionAccuracy ${input.predictionAccuracy} < ${DOWNGRADE_PREDICTION_ACCURACY}`);
  }
  if (input.unsafeActionRate > DOWNGRADE_UNSAFE_ACTION_RATE) {
    downgradeReasons.push(`unsafeActionRate ${input.unsafeActionRate} > ${DOWNGRADE_UNSAFE_ACTION_RATE}`);
  }
  if (input.staleStateViolations > DOWNGRADE_MIN_STALE_VIOLATIONS - 1) {
    downgradeReasons.push(`staleStateViolations ${input.staleStateViolations} > 0`);
  }
  if (input.rollbackFrequency > DOWNGRADE_ROLLBACK_FREQUENCY) {
    downgradeReasons.push(`rollbackFrequency ${input.rollbackFrequency} > ${DOWNGRADE_ROLLBACK_FREQUENCY}`);
  }
  if (input.policyCompliance < DOWNGRADE_POLICY_COMPLIANCE) {
    downgradeReasons.push(`policyCompliance ${input.policyCompliance} < ${DOWNGRADE_POLICY_COMPLIANCE}`);
  }

  const allUpgradeConditionsMet =
    input.predictionAccuracy >= UPGRADE_PREDICTION_ACCURACY &&
    input.policyCompliance >= UPGRADE_POLICY_COMPLIANCE &&
    input.unsafeActionRate <= UPGRADE_UNSAFE_ACTION_RATE &&
    input.humanOverrides <= UPGRADE_MAX_HUMAN_OVERRIDES &&
    input.recoverySuccess >= UPGRADE_RECOVERY_SUCCESS &&
    input.staleStateViolations <= UPGRADE_MAX_STALE_VIOLATIONS &&
    input.robustness >= UPGRADE_MIN_ROBUSTNESS;

  const hasDowngrade = downgradeReasons.length > 0;

  if (hasDowngrade && levelRank(level) > 0) {
    reasons.push(...downgradeReasons);
    const newLevel = levelAt(levelRank(level) - 1);
    reasons.push(`downgraded from ${level} to ${newLevel}`);
    return { level: newLevel, direction: "down", reason: reasons };
  }

  if (allUpgradeConditionsMet && levelRank(level) < LEVEL_ORDER.length - 1) {
    const upgradeReasons = [
      `predictionAccuracy ${input.predictionAccuracy} >= ${UPGRADE_PREDICTION_ACCURACY}`,
      `policyCompliance ${input.policyCompliance} >= ${UPGRADE_POLICY_COMPLIANCE}`,
      `unsafeActionRate ${input.unsafeActionRate} <= ${UPGRADE_UNSAFE_ACTION_RATE}`,
      `humanOverrides ${input.humanOverrides} <= ${UPGRADE_MAX_HUMAN_OVERRIDES}`,
      `recoverySuccess ${input.recoverySuccess} >= ${UPGRADE_RECOVERY_SUCCESS}`,
      `staleStateViolations ${input.staleStateViolations} <= ${UPGRADE_MAX_STALE_VIOLATIONS}`,
      `robustness ${input.robustness} >= ${UPGRADE_MIN_ROBUSTNESS}`,
    ];
    reasons.push(...upgradeReasons);
    const newLevel = levelAt(levelRank(level) + 1);
    reasons.push(`upgraded from ${level} to ${newLevel}`);
    return { level: newLevel, direction: "up", reason: reasons };
  }

  if (hasDowngrade) {
    reasons.push(...downgradeReasons);
    reasons.push(`would downgrade but already at minimum level ${level}`);
  } else if (allUpgradeConditionsMet) {
    reasons.push(`all upgrade conditions met but already at maximum level ${level}`);
  } else {
    reasons.push("no upgrade or downgrade conditions triggered");
  }

  return { level, direction: "same", reason: reasons };
}

// ── Stateful AutonomyEngine (recorded-outcome based) ────────────────

export interface OutcomeRecord {
  decisionId: string;
  worldRevision: number;
  predictionAccuracy: number;
  compliance: boolean;
  override: boolean;
  recovery: boolean;
  rollback: boolean;
  staleViolation: boolean;
  robustnessScore: number;
  timestamp: number;
}

export interface AutonomyState {
  level: AuthorityLevel;
  history: OutcomeRecord[];
  lastChange: { from: AuthorityLevel; to: AuthorityLevel; reason: string; timestamp: number } | null;
}

const LEVEL_RANK = AUTHORITY_RANK;
const RANK_LEVEL: Record<number, AuthorityLevel> = { 0: "L0", 1: "L1", 2: "L2", 3: "L3", 4: "L4" };

const WINDOW = 5;

const LEVEL_ACTION_CAPS: Record<AuthorityLevel, Array<{ actionPattern: string; riskLevel: string }>> = {
  L0: [],
  L1: [{ actionPattern: "observe", riskLevel: "low" }],
  L2: [{ actionPattern: "observe", riskLevel: "low" }, { actionPattern: "increase_cache_capacity", riskLevel: "low" }],
  L3: [
    { actionPattern: "*", riskLevel: "low" },
    { actionPattern: "*", riskLevel: "medium" },
  ],
  L4: [
    { actionPattern: "*", riskLevel: "low" },
    { actionPattern: "*", riskLevel: "medium" },
  ],
};

export class AutonomyEngine {
  private state: AutonomyState;
  private readonly initialLevel: AuthorityLevel;

  constructor(initialLevel: AuthorityLevel = "L3") {
    this.initialLevel = initialLevel;
    this.state = { level: initialLevel, history: [], lastChange: null };
  }

  recordOutcome(outcome: OutcomeRecord): void {
    this.state.history.push(outcome);
    const previousLevel = this.state.level;
    const newLevel = this.computeLevel();
    if (newLevel !== previousLevel) {
      this.state.lastChange = {
        from: previousLevel,
        to: newLevel,
        reason: this.describeChange(previousLevel, newLevel, this.state.history.slice(-WINDOW)),
        timestamp: outcome.timestamp,
      };
      this.state.level = newLevel;
    }
  }

  evaluateLevel(): AuthorityLevel {
    return this.computeLevel();
  }

  getState(): Readonly<AutonomyState> {
    return this.state;
  }

  canPerform(actionType: string, riskLevel: string): { allowed: boolean; reason: string } {
    const rank = LEVEL_RANK[this.state.level];
    if (rank < 3) {
      return { allowed: false, reason: `autonomy level ${this.state.level} does not permit execution` };
    }
    const caps = LEVEL_ACTION_CAPS[this.state.level];
    const riskRank = { low: 0, medium: 1, high: 2 }[riskLevel] ?? 0;
    for (const cap of caps) {
      const patternMatch = cap.actionPattern === "*" || cap.actionPattern === actionType;
      const maxRiskRank = { low: 0, medium: 1, high: 2 }[cap.riskLevel] ?? 0;
      if (patternMatch && riskRank <= maxRiskRank) {
        return { allowed: true, reason: `level ${this.state.level} permits ${actionType} at ${riskLevel}` };
      }
    }
    return { allowed: false, reason: `level ${this.state.level} does not cover action '${actionType}' at risk '${riskLevel}'` };
  }

  private computeLevel(): AuthorityLevel {
    const window = this.state.history.slice(-WINDOW);
    if (window.length < 3) return this.initialLevel;
    let rank = LEVEL_RANK[this.initialLevel];
    const avgAccuracy = window.reduce((s, o) => s + o.predictionAccuracy, 0) / window.length;
    const rollbackCount = window.filter((o) => o.rollback).length;
    const staleCount = window.filter((o) => o.staleViolation).length;
    if (avgAccuracy < 0.6) {
      rank = Math.max(0, rank - 1);
    } else if (rollbackCount > 2) {
      rank = Math.max(0, rank - 1);
    } else if (staleCount > 1) {
      rank = Math.max(0, rank - 1);
    } else {
      const allCompliant = window.every((o) => o.compliance);
      if (allCompliant && avgAccuracy > 0.8 && rollbackCount === 0 && rank < 4) {
        rank = rank + 1;
      }
    }
    return RANK_LEVEL[rank];
  }

  private describeChange(from: AuthorityLevel, to: AuthorityLevel, window: OutcomeRecord[]): string {
    const avgAccuracy = window.reduce((s, o) => s + o.predictionAccuracy, 0) / window.length;
    const rollbackCount = window.filter((o) => o.rollback).length;
    const staleCount = window.filter((o) => o.staleViolation).length;
    if (LEVEL_RANK[to] < LEVEL_RANK[from]) {
      if (avgAccuracy < 0.6) return `downgrade: avg prediction accuracy ${(avgAccuracy * 100).toFixed(0)}% < 60% over last ${window.length}`;
      if (rollbackCount > 2) return `downgrade: ${rollbackCount} rollbacks in last ${window.length} outcomes`;
      if (staleCount > 1) return `downgrade: ${staleCount} stale-plan violations in last ${window.length}`;
      return `downgrade: sustained poor performance`;
    }
    if (LEVEL_RANK[to] > LEVEL_RANK[from]) {
      return `upgrade: all compliant, avg accuracy ${(avgAccuracy * 100).toFixed(0)}%, no rollbacks over last ${window.length}`;
    }
    return "no change";
  }
}
