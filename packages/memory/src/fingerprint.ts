/**
 * State fingerprinting (implementation-v2.md §11.2, §11.3).
 *
 * A compact, deterministic string that identifies an operational state so that
 * decision memory can retrieve similar historical states. Built from a flat
 * metric map; equal fingerprints mean equivalent observable state.
 */

/** Deterministic, stable fingerprint of a metric map (sorted keys). */
export function fingerprintState(metrics: Record<string, number>): string {
  const keys = Object.keys(metrics).sort();
  return keys.map((k) => `${k}:${metrics[k]}`).join("|");
}

/** Hamming-ish distance between two numeric metric vectors (normalized 0..1). */
export function stateDistance(a: Record<string, number>, b: Record<string, number>): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const shared = [...keys].filter((k) => k in a && k in b);
  if (shared.length === 0) return 1;
  let sum = 0;
  for (const k of shared) {
    const av = a[k];
    const bv = b[k];
    const denom = Math.max(Math.abs(av), Math.abs(bv), 1);
    sum += Math.abs(av - bv) / denom;
  }
  return Math.min(1, sum / shared.length);
}
