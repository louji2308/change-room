/**
 * AgentModel factory + public exports.
 *
 * `loadAgentModel()` chooses:
 *   - a live FallbackAgentModel (OpenAI -> NVIDIA -> Mistral -> OpenRouter) when at least
 *     one provider key is present, OR
 *   - the deterministic MockModel otherwise (graceful offline/no-key fallback).
 *
 * Keys are read from `process.env` on the server; they are never exposed to the
 * browser and never written to the repo.
 */

import type { AgentModel } from "./interface.js";
import { FallbackAgentModel } from "./fallback.js";
import { MockModel } from "./mock.js";
import type { ProviderEnv } from "./providers.js";

export type { AgentModel, CompletionOut, CompletionOptions, ModelMessage } from "./interface.js";
export { FallbackAgentModel } from "./fallback.js";
export { MockModel } from "./mock.js";
export type { ProviderEnv } from "./providers.js";

export interface AgentModelEnv extends ProviderEnv {
  /** Force the deterministic mock regardless of configured keys (tests). */
  forceMock?: boolean;
}

/** Source keys from process.env (server-side). */
export function envFromProcess(): AgentModelEnv {
  const get = (k: string): string | undefined => {
    const v = process.env[k];
    return v && v.length > 0 ? v : undefined;
  };
  return {
    openaiKey: get("OPENAI_API_KEY"),
    nvidiaKey: get("LLM_NVIDIA_API_KEY"),
    mistralKey: get("LLM_MISTRAL_API_KEY"),
    openrouterKey: get("LLM_OPENROUTER_API_KEY"),
    openaiModel: get("OPENAI_MODEL"),
    nvidiaModel: get("LLM_NVIDIA_MODEL"),
    mistralModel: get("LLM_MISTRAL_MODEL"),
    openrouterModel: get("LLM_OPENROUTER_MODEL"),
  };
}

/** Build the appropriate AgentModel from an env source. */
export function loadAgentModel(env: AgentModelEnv = envFromProcess()): {
  model: AgentModel;
  isMock: boolean;
} {
  if (env.forceMock) return { model: new MockModel(), isMock: true };

  const live = new FallbackAgentModel(env);
  if (live.hasLiveProvider) return { model: live, isMock: false };

  return { model: new MockModel(), isMock: true };
}
