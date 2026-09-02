/**
 * WebMCP browser adapter (Implementation.md §7.1, §7.7).
 *
 * Registers the Change Room tool surface on the host's `document.modelContext`
 * when present (feature-detected), and updates availability via the
 * `toolchange` event as workflow state advances. If WebMCP is unavailable,
 * registration is a safe no-op so the app still works in an ordinary browser.
 */

import type { ToolDefinition } from "./tools.js";
import { TOOLS } from "./tools.js";
import type { WebmcpRegistry } from "./registry.js";

/** Minimal shape of the WebMCP host API. */
interface WebmcpHost {
  registerTool?: (tool: {
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
    execute: (input: unknown, options: { signal: AbortSignal }) => unknown | Promise<unknown>;
  }) => void | Promise<void>;
  listTools?: () => Array<{ name: string }>;
  emitEvent?: (type: string, detail?: unknown) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyGlobal = any;

/** Read the WebMCP host (feature-detected) off the document global. */
function host(): WebmcpHost | undefined {
  if (typeof document === "undefined") return undefined;
  const g = document as AnyGlobal;
  return g?.modelContext as WebmcpHost | undefined;
}

/**
 * Register all tools with the WebMCP host. Each tool's `execute` delegates to
 * the registry so enforcement (schema/state/permission) is preserved.
 * Returns the list of successfully registered tool names (empty if unavailable).
 */
export async function registerWithWebmcp(registry: WebmcpRegistry): Promise<string[]> {
  const h = host();
  if (!h || typeof h.registerTool !== "function") return [];

  const registered: string[] = [];
  const defs: ToolDefinition[] = TOOLS;
  for (const def of defs) {
    try {
      await h.registerTool({
        name: def.name,
        description: def.description,
        inputSchema: def.inputSchema as unknown as Record<string, unknown>,
        execute: async (input: unknown, options: { signal: AbortSignal }) => {
          const res = await registry.invoke(def.name, input);
          if (!res.ok) {
            return { ok: false, error: res.error, validation: res.validation };
          }
          return { ok: true, data: res.data };
        },
      });
      registered.push(def.name);
    } catch {
      // Individual tool registration failures are non-fatal.
    }
  }
  return registered;
}

/**
 * Emit a `toolchange` event so WebMCP-aware clients refresh the available tool
 * list when the workflow state changes. No-op when WebMCP is unavailable.
 */
export function emitToolChange(): void {
  const h = host();
  if (h && typeof h.emitEvent === "function") {
    h.emitEvent("toolchange");
  }
}

export function webmcpAvailable(): boolean {
  return host() != null;
}
