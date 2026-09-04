/**
 * Provider definitions for the Change Room reasoning layer.
 *
 * Verified live this session:
 *   - OpenAI `gpt-4o-mini` (standard OpenAI API, Bearer token auth)
 *   - Mistral  `mistral-large-latest`  -> 200 OK
 *   - OpenRouter `deepseek/deepseek-chat` -> 200 OK
 *   - NVIDIA key is valid (models list 200); the deepseek-v4-flash model may be
 *     account-grant gated for `/v1/chat/completions` (404 "Function not found").
 *     The fallback chain covers this transparently.
 */

import type { ProviderConfig } from "./openai-compatible.js";

export interface ProviderEnv {
  openaiKey?: string;
  nvidiaKey?: string;
  mistralKey?: string;
  openrouterKey?: string;
  openaiModel?: string;
  nvidiaModel?: string;
  mistralModel?: string;
  openrouterModel?: string;
}

/** Ordered fallback chain: OpenAI (preferred) -> NVIDIA -> Mistral -> OpenRouter. */
export function providerChain(env: ProviderEnv): ProviderConfig[] {
  return [
    {
      name: "openai",
      baseUrl: "https://api.openai.com/v1",
      authHeader: (k) => `Bearer ${k}`,
      defaultModel: env.openaiModel ?? "gpt-4o-mini",
    },
    {
      name: "nvidia",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      authHeader: (k) => `Bearer ${k}`,
      defaultModel: env.nvidiaModel ?? "deepseek-ai/deepseek-v4-flash-0731",
    },
    {
      name: "mistral",
      baseUrl: "https://api.mistral.ai/v1",
      authHeader: (k) => `Bearer ${k}`,
      defaultModel: env.mistralModel ?? "mistral-large-latest",
    },
    {
      name: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      authHeader: (k) => `Bearer ${k}`,
      defaultModel: env.openrouterModel ?? "deepseek/deepseek-chat",
    },
  ];
}
