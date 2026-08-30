/**
 * Stale-plan validation (Implementation.md §5.5).
 *
 * Every plan is bound to a state version. Before execution the plan's recorded
 * version must equal the current state version, otherwise the plan is STALE and
 * the agent must re-observe and re-plan.
 */

export interface StateVersionProvider {
  currentVersion(): number;
}

export type StaleStatus =
  | { ok: true; reason: string }
  | { ok: false; stale: true; planVersion: number; currentVersion: number; reason: string };

export function validatePlanFreshness(
  planStateVersion: number,
  currentVersion: number
): StaleStatus {
  if (planStateVersion === currentVersion) {
    return { ok: true, reason: `plan is fresh against state version ${currentVersion}` };
  }
  return {
    ok: false,
    stale: true,
    planVersion: planStateVersion,
    currentVersion,
    reason: `STALE_PLAN: plan bound to version ${planStateVersion} but current state is ${currentVersion}`,
  };
}

/** Convenience wrapper that reads the current version from a provider. */
export function validatePlanAgainstStore(
  planStateVersion: number,
  provider: StateVersionProvider
): StaleStatus {
  return validatePlanFreshness(planStateVersion, provider.currentVersion());
}
