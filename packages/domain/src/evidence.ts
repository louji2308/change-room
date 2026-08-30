/**
 * Evidence (Idea.md §19). Every recommendation must be supported by evidence
 * that includes a source, timestamp, trust level, relevance and uncertainty.
 */

export type TrustLevel = "trusted-system" | "external" | "user-generated" | "agent-generated";

export interface Evidence {
  id: string;
  /** Human label, e.g. "checkout latency spike". */
  label: string;
  /** Observed metric/value, e.g. "checkoutLatencyMs" -> 480. */
  metric: string;
  value: number | string;
  /** E.g. "metrics", "logs", "business-kpi", "history". */
  source: string;
  /** Model time when the observation was taken. */
  timestamp: number;
  /** How relevant this is to the current objective (0..1). */
  relevance: number;
  /** Trust classification of the source. */
  trust: TrustLevel;
  /** Agent's uncertainty about this observation (0..1). */
  uncertainty: number;
}

export function evidenceOverrideOf(primary: number, evidence: Evidence[]): number {
  const trusted = evidence.filter((e) => e.trust !== "user-generated");
  if (trusted.length === 0) return primary;
  if (trusted.some((e) => e.trust === "agent-generated")) return 0.6 * primary;
  return primary;
}
