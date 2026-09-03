/**
 * Lesson extractor (implementation-v2.md §11, §12.1).
 *
 * Turns a prediction/reality comparison into a persisted operational lesson:
 * the predicted outcome, the actual outcome, the error, the attributed cause,
 * and a human-readable lesson. lessons feed the memory package (B1).
 */

import type { ErrorAttribution } from "./prediction-error.js";

export interface LessonInput {
  planId: string;
  worldRevision: number;
  predicted: Record<string, number>;
  actual: Record<string, number>;
  error: { attribution: ErrorAttribution; cause: string; metric?: string };
  outcomeKind: string;
  nextAction: string;
}

export interface Lesson {
  lessonId: string;
  planId: string;
  worldRevision: number;
  predicted: Record<string, number>;
  actual: Record<string, number>;
  attribution: ErrorAttribution;
  cause: string;
  outcomeKind: string;
  nextAction: string;
  text: string;
  createdAt: number;
}

let lessonSeq = 0;

/** Produce a persisted, structured lesson from a prediction/reality comparison. */
export function extractLesson(input: LessonInput): Lesson {
  const text = [
    `Plan ${input.planId} (rev ${input.worldRevision}):`,
    `predicted ${format(input.predicted)}`,
    `actual ${format(input.actual)}`,
    `error attributed to '${input.error.attribution}' — ${input.error.cause}`,
    `outcome ${input.outcomeKind}; next action ${input.nextAction}.`,
  ].join(" ");

  return {
    lessonId: `lesson_${++lessonSeq}`,
    planId: input.planId,
    worldRevision: input.worldRevision,
    predicted: { ...input.predicted },
    actual: { ...input.actual },
    attribution: input.error.attribution,
    cause: input.error.cause,
    outcomeKind: input.outcomeKind,
    nextAction: input.nextAction,
    text,
    createdAt: Date.now(),
  };
}

function format(metrics: Record<string, number>): string {
  const parts = Object.entries(metrics)
    .slice(0, 5)
    .map(([k, v]) => `${k}=${v}`);
  return `{${parts.join(", ")}${Object.keys(metrics).length > 5 ? ", ..." : ""}}`;
}
