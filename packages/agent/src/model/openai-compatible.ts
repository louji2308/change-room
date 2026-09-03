/**
 * Minimal OpenAI-compatible `chat/completions` client.
 *
 * All three providers (NVIDIA, Mistral, OpenRouter) expose an OpenAI-shaped
 * HTTP API, so one thin client serves them all. Only the base URL, auth header
 * and model defaults differ. Uses the global `fetch` (Node 18+) — no extra
 * dependency.
 */

import type { CompletionOptions, ModelMessage } from "./interface.js";

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  /** Returns the Authorization header value for a given API key. */
  authHeader: (apiKey: string) => string;
  defaultModel: string;
}

export interface ChatCompletionResponse {
  content?: string;
  provider: string;
  model: string;
  usage?: { prompt?: number; completion?: number; total?: number };
}

/** POST a chat-completions request and surface a clean error on failure. */
export async function chatComplete(
  cfg: ProviderConfig,
  apiKey: string | undefined,
  messages: ModelMessage[],
  options: CompletionOptions = {}
): Promise<ChatCompletionResponse> {
  if (!apiKey) throw new Error(`${cfg.name}: no API key configured`);

  const body: Record<string, unknown> = {
    model: options.model ?? cfg.defaultModel,
    messages,
    max_tokens: options.maxTokens ?? 512,
    temperature: options.temperature ?? 0.2,
    stream: false,
  };
  if (options.responseFormat === "json" || options.responseFormat === "json_object") {
    body["response_format"] =
      options.responseFormat === "json_object" ? { type: "json_object" } : { type: "json_object" };
  }

  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: cfg.authHeader(apiKey),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout((options.timeoutMs ?? 60000)),
    });
  } catch (err) {
    throw new Error(`${cfg.name}: request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${cfg.name}: HTTP ${res.status} ${res.statusText} — ${detail.slice(0, 300)}`);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new Error(`${cfg.name}: invalid JSON response: ${err instanceof Error ? err.message : String(err)}`);
  }

  const data = json as {
    choices?: Array<{ message?: { content?: string | null } }>;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const content = data.choices?.[0]?.message?.content ?? null;
  if (content == null) throw new Error(`${cfg.name}: empty completion`);

  return {
    content,
    provider: cfg.name,
    model: data.model ?? cfg.defaultModel,
    usage: data.usage
      ? {
          prompt: data.usage.prompt_tokens,
          completion: data.usage.completion_tokens,
          total: data.usage.total_tokens,
        }
      : undefined,
  };
}


