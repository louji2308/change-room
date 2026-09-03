export type DecisionDimension =
  | "diagnosis"
  | "evidence"
  | "action"
  | "prediction"
  | "policy"
  | "stateFreshness"
  | "robustness";

export type DecisionConfidence = {
  [k in DecisionDimension]: number;
};

const DIMENSIONS: DecisionDimension[] = [
  "diagnosis",
  "evidence",
  "action",
  "prediction",
  "policy",
  "stateFreshness",
  "robustness",
];

function clamp(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function createDecisionConfidence(
  partial?: Partial<DecisionConfidence> & { diagnosis: number },
): DecisionConfidence {
  if (!partial || !("diagnosis" in partial) || partial.diagnosis === undefined) {
    throw new TypeError("createDecisionConfidence requires 'diagnosis' field");
  }
  const out = {} as Record<string, number>;
  for (const d of DIMENSIONS) {
    const raw =
      d in partial
        ? (partial as Record<string, number>)[d]
        : 0.5;
    out[d] = clamp(raw);
  }
  return out as DecisionConfidence;
}
