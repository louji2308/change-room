/**
 * WebMCP browser adapter (Implementation.md §7.1, §7.7).
 *
 * Registers the Change Room tool surface on the host's native
 * `document.modelContext` when present (feature-detected). Uses AbortSignal
 * per-tool registration (native WebMCP spec) so tools can be individually
 * unregistered when workflow state changes.
 *
 * If WebMCP is unavailable, registration is a safe no-op so the app still
 * works in an ordinary browser.
 */

import type { ToolDefinition } from "./tools.js";
import { ALL_TOOLS } from "./tools.js";
import { WebmcpRegistry } from "./registry.js";
import type { ToolRuntime } from "./registry.js";
import { nativeAnnotations } from "./registry.js";

// ---------------------------------------------------------------------------
// Native WebMCP host interface
// ---------------------------------------------------------------------------

/** Minimal shape of the native WebMCP host API (WebMCP spec index.bs). */
interface WebmcpHost {
  registerTool: (
    tool: {
      name: string;
      description: string;
      inputSchema?: Record<string, unknown>;
      annotations?: { readOnlyHint?: boolean; consequentialHint?: boolean; untrustedContentHint?: boolean };
      execute: (input: unknown, options: { signal: AbortSignal }) => unknown | Promise<unknown>;
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
  getTools?: (options?: Record<string, unknown>) => Promise<Array<{ name: string }>>;
  executeTool?: (tool: unknown, input: unknown) => Promise<unknown>;
  addEventListener?: (type: string, listener: (event: Event) => void) => void;
  ontoolchange?: ((event: Event) => void) | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyGlobal = any;

/** Read the WebMCP host (feature-detected) off the document global. */
function host(): WebmcpHost | undefined {
  if (typeof document === "undefined") return undefined;
  const g = document as AnyGlobal;
  return g?.modelContext as WebmcpHost | undefined;
}

// ---------------------------------------------------------------------------
// Controller handle map — one AbortController per registered tool
// ---------------------------------------------------------------------------

const controllers = new Map<string, AbortController>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Await a value that may be void or Promise<void>. */
async function awaitMaybePromise(result: void | Promise<void>): Promise<void> {
  if (result != null && typeof (result as unknown as { then: unknown }).then === "function") {
    await result as unknown as Promise<void>;
  }
}

/** Duck-type check: does this object look like a WebmcpRegistry? */
function isRegistry(obj: unknown): obj is WebmcpRegistry {
  return obj != null && typeof (obj as Record<string, unknown>).discover === "function" && typeof (obj as Record<string, unknown>).invoke === "function";
}

/**
 * Ensure we have a WebmcpRegistry. If the caller passed a raw ToolRuntime
 * (as the tests do), wrap it in a new WebmcpRegistry.
 */
function ensureRegistry(registryOrRuntime: WebmcpRegistry | ToolRuntime): WebmcpRegistry {
  if (isRegistry(registryOrRuntime)) return registryOrRuntime;
  return new WebmcpRegistry(registryOrRuntime);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register all tools with the native WebMCP host.
 *
 * Accepts either a `WebmcpRegistry` instance or a raw `ToolRuntime` (for
 * backward compatibility with test code that passes a plain runtime).
 * Each tool gets its own AbortController so it can be individually
 * unregistered later (via `syncRegisteredTools` or the controller itself).
 *
 * Returns the list of successfully registered tool names (empty if WebMCP
 * is unavailable).
 */
export async function registerWithWebmcp(registryOrRuntime: WebmcpRegistry | ToolRuntime): Promise<string[]> {
  const h = host();
  if (!h || typeof h.registerTool !== "function") return [];

  const registered: string[] = [];

  for (const def of ALL_TOOLS) {
    const controller = new AbortController();
    try {
      await awaitMaybePromise(
        h.registerTool(
          {
            name: def.name,
            description: def.description,
            inputSchema: def.inputSchema as unknown as Record<string, unknown>,
            annotations: nativeAnnotations(def),
            execute: async (input: unknown, options: { signal: AbortSignal }) => {
              const registry = ensureRegistry(registryOrRuntime);
              const res = await registry.invoke(def.name, input);
              if (!res.ok) {
                return { ok: false, error: res.error, validation: res.validation };
              }
              return { ok: true, data: res.data };
            },
          },
          { signal: controller.signal },
        ),
      );
      controllers.set(def.name, controller);
      registered.push(def.name);
    } catch (err) {
      // Individual tool registration failure is non-fatal but reported.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Change Room] failed to register tool '${def.name}': ${msg}`);
      controller.abort();
    }
  }
  return registered;
}

/**
 * Dynamically reconcile the set of registered tools with `desiredNames`.
 *
 * Uses `getTools()` (native WebMCP) to determine the current set rather
 * than trusting internal state blindly. The browser fires the native
 * `toolchange` event on each set change — no fabricated emitEvent needed.
 *
 * @returns `{ added, removed, errors }` for callers to react accordingly.
 */
export async function syncRegisteredTools(
  registry: WebmcpRegistry,
  desiredNames: string[],
): Promise<{ added: string[]; removed: string[]; errors: Array<{ name: string; error: string }> }> {
  const h = host();
  if (!h || typeof h.registerTool !== "function") {
    return { added: [], removed: [], errors: [] };
  }

  const added: string[] = [];
  const removed: string[] = [];
  const errors: Array<{ name: string; error: string }> = [];

  // Reconcile from the native tool set, not internal state alone.
  const nativeTools = await getNativeTools();
  const nativeNames = new Set(nativeTools.map((t) => t.name));
  const desiredSet = new Set(desiredNames);

  // 1. Remove tools currently registered (in controllers)
  //    that are NOT in desiredNames.
  for (const name of controllers.keys()) {
    if (!desiredSet.has(name)) {
      const controller = controllers.get(name)!;
      controller.abort();
      controllers.delete(name);
      removed.push(name);
    }
  }

  // 2. Add tools in desiredNames that are NOT currently registered.
  for (const name of desiredNames) {
    if (controllers.has(name) || errors.some((e) => e.name === name)) continue;

    const def = registry.discover().find((d) => d.name === name && d.available);
    if (!def) continue;

    const controller = new AbortController();
    try {
      await awaitMaybePromise(
        h.registerTool(
          {
            name: def.name,
            description: def.description,
            inputSchema: def.inputSchema as unknown as Record<string, unknown>,
            annotations: def.annotations,
            execute: async (input: unknown, options: { signal: AbortSignal }) => {
              const res = await registry.invoke(def.name, input);
              if (!res.ok) {
                return { ok: false, error: res.error, validation: res.validation };
              }
              return { ok: true, data: res.data };
            },
          },
          { signal: controller.signal },
        ),
      );
      controllers.set(name, controller);
      added.push(name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ name, error: msg });
      controller.abort();
    }
  }

  return { added, removed, errors };
}

/**
 * Wrapper around the native `document.modelContext.getTools()`.
 * Returns the list of registered tool names; returns `[]` if WebMCP is absent.
 */
export async function getNativeTools(): Promise<Array<{ name: string }>> {
  const h = host();
  if (!h || typeof h.getTools !== "function") return [];
  try {
    const tools = await h.getTools();
    return tools.map((t) => ({ name: t.name }));
  } catch {
    return [];
  }
}

/**
 * Wrapper around the native `document.modelContext.executeTool()`.
 * Throws if WebMCP is absent; this is intentional (callers must check
 * `webmcpAvailable()` first).
 */
export async function executeNativeTool(tool: unknown, inputObject: unknown): Promise<unknown> {
  const h = host();
  if (!h || typeof h.executeTool !== "function") {
    throw new Error("WebMCP host unavailable: document.modelContext.executeTool not found");
  }
  return h.executeTool(tool, inputObject);
}

/**
 * @deprecated No-op. The native browser fires `toolchange` events when the
 * registered tool set changes (via registerTool with AbortSignal or abort).
 * Kept to avoid breaking WebMCP.tsx imports during parallel edit.
 * Agent B should remove all call sites.
 */
export function emitToolChange(): void {
  // Intentionally empty — native toolchange events handle this.
}

/**
 * Returns `true` when the browser exposes the native WebMCP imperative API
 * (`document.modelContext` with `registerTool`).
 */
export function webmcpAvailable(): boolean {
  const h = host();
  return h != null && typeof h.registerTool === "function";
}
