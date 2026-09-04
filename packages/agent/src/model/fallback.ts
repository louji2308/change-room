/**
 * Real-provider AgentModel with automatic fallback.
 *
 * Attempts OpenAI first (preferred), then NVIDIA, then Mistral, then OpenRouter. Each
 * provider is only attempted when its API key is present; a misconfigured or
 * unresponsive provider is skipped (recorded in `trace`) rather than failing
 * the whole call. Throws only when every provider fails.
 */

import type { AgentModel, CompletionOptions, CompletionOut, ModelMessage } from "./interface.js";
import { chatComplete, type ProviderConfig } from "./openai-compatible.js";
import { providerChain, type ProviderEnv } from "./providers.js";

export interface FallbackAgentModelOptions extends ProviderEnv {
  /** Timeout per provider call, ms. */
  timeoutMs?: number;
}

export class FallbackAgentModel implements AgentModel {
  private readonly chain: Array<{ cfg: ProviderConfig; key: string }>;
  private readonly timeoutMs: number;

  constructor(private readonly env: FallbackAgentModelOptions) {
    this.timeoutMs = env.timeoutMs ?? 60000;
    const keyFor = (name: string): string => {
      switch (name) {
        case "openai":
          return env.openaiKey ?? "";
        case "nvidia":
          return env.nvidiaKey ?? "";
        case "mistral":
          return env.mistralKey ?? "";
        case "openrouter":
          return env.openrouterKey ?? "";
        default:
          return "";
      }
    };
    this.chain = providerChain(env)
      .map((cfg) => ({ cfg, key: keyFor(cfg.name) }))
      .filter((e) => e.key.length > 0);
  }

  /** True when at least one provider key is configured for the live call. */
  get hasLiveProvider(): boolean {
    return this.chain.length > 0;
  }

  async complete(messages: ModelMessage[], options: CompletionOptions = {}): Promise<CompletionOut> {
    const trace: string[] = [];
    let lastError: unknown;

    for (const { cfg, key } of this.chain) {
      try {
        const out = await chatComplete(
          cfg,
          key,
          messages,
          { ...options, timeoutMs: this.timeoutMs }
        );
        trace.push(`${cfg.name}:ok`);
        return {
          text: out.content ?? "",
          provider: out.provider,
          model: out.model,
          isMock: false,
          usage: out.usage,
          trace,
        };
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        trace.push(`${cfg.name}:${msg.split(":")[0] || "error"}`);
      }
    }

    throw new Error(
      `FallbackAgentModel: all providers failed (${trace.join(", ")}) — ${lastError && lastError instanceof Error ? lastError.message : String(lastError)}`
    );
  }

  describe(): { provider: string; model: string; isMock: boolean } {
    if (this.chain.length === 0) return { provider: "none", model: "none", isMock: true };
    const { cfg } = this.chain[0];
    return { provider: cfg.name, model: cfg.defaultModel, isMock: false };
  }
}
