/**
 * Change Room — AgentModel (LLM reasoning layer) contract.
 *
 * The model is a *reasoning advisor only*. It formulates intent interpretations,
 * hypotheses, plan proposals, alternative-future comparisons, adversarial
 * self-challenges, prediction/reality explanations and lesson drafts. It holds
 * NO state-changing authority: policy, permissions, risk limits, state
 * revisions, execution gates and rollback all remain in the deterministic
 * control layer, which never delegates a consequential decision to the model.
 *
 * Three implementations share this exact contract:
 *   - Real providers (NVIDIA -> Mistral -> OpenRouter) with automatic fallback.
 *   - MockModel (deterministic, offline) used by the hermetic test suite and as
 *     a graceful fallback when no API key is configured.
 */

import type { AgentView } from "@change-room/scenarios";

/** A single chat message. */
export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Optional structured constraints for a single completion call. */
export interface CompletionOptions {
  /** Hard cap on generated tokens. */
  maxTokens?: number;
  /** Sampling temperature (0 = greedy/deterministic). */
  temperature?: number;
  /** Ask the provider to emit JSON in this shape (stringified schema or instruction). */
  responseFormat?: "json" | "json_object" | "text";
  /** Override the model id for this call (fallback-chain internal). */
  model?: string;
  /** Request timeout in ms (fallback-chain internal). */
  timeoutMs?: number;
}

/** A single completion call: prompt in, text out. */
export interface CompletionOut {
  text: string;
  /** Which provider/model actually served the call, e.g. "mistral / mistral-large-latest". */
  provider: string;
  model: string;
  /** True when the result came from the deterministic offline mock. */
  isMock: boolean;
  /** Token usage when reported by the provider. */
  usage?: { prompt?: number; completion?: number; total?: number };
  /** Human-readable fallback trace, e.g. ["nvidia:404", "mistral:ok"]. */
  trace: string[];
}

/** The LLM reasoning layer contract used by the orchestrator. */
export interface AgentModel {
  /** Run a single completion. Throws only if every provider fails. */
  complete(messages: ModelMessage[], options?: CompletionOptions): Promise<CompletionOut>;
  /** Identity of the active provider/model (for audit/trace). */
  describe(): { provider: string; model: string; isMock: boolean };
}

export type { AgentView };
