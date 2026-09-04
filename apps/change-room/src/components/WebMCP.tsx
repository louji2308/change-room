"use client";

import { useEffect, useRef } from "react";
import {
  WebmcpRegistry,
  registerWithWebmcp,
  syncRegisteredTools,
  webmcpAvailable,
} from "@change-room/webmcp";
import type { WorkflowState } from "@change-room/domain";

/**
 * Registers Change Room's semantic tool surface with the native WebMCP host
 * (`document.modelContext`) when available, and keeps the set of registered
 * tools in sync as the workflow state advances.
 *
 * Lifecycle:
 *   1. Mount → startup probe with retries (host may attach after hydration)
 *   2. Poll `/api/session` every ~2 s → `registry.discover()` → `syncRegisteredTools()`
 *   3. Browser fires native `toolchange` on every add/remove
 *   4. Cleanup → abort all outstanding AbortControllers
 */
export default function WebMCP() {
  const workflowRef = useRef<WorkflowState>("IDLE");
  const registryRef = useRef<WebmcpRegistry | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── 1. Mount: probe + initial registration ────────────────────────────
  useEffect(() => {
    if (typeof document === "undefined") return;

    const runtime = {
      workflowState: () => workflowRef.current,
      execute: async (name: string, args: Record<string, unknown>) => {
        const res = await fetch("/api/tools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, args }),
        });
        const json = await res.json();
        if (!res.ok)
          return { ok: false, error: json.error, validation: json.validation };
        return { ok: true, data: json.data };
      },
    };

    const registry = new WebmcpRegistry(runtime);
    registryRef.current = registry;

    const MAX_ATTEMPTS = 10;
    const INTERVAL_MS = 300;
    let attempt = 0;
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function tryRegister() {
      attempt++;
      if (disposed) return;

      if (!webmcpAvailable()) {
        if (attempt < MAX_ATTEMPTS) return; // wait for next tick
        // Give up silently — no WebMCP host on this page
        if (timer) clearInterval(timer);
        return;
      }

      if (timer) clearInterval(timer);

      try {
        const names = await registerWithWebmcp(registry);
        if (!disposed && names.length > 0) {
          // eslint-disable-next-line no-console
          console.info(
            `[Change Room] registered ${names.length} WebMCP tools`,
          );
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[Change Room] initial WebMCP registration failed:", err);
      }
    }

    // Kick off first attempt immediately, then retry on interval
    tryRegister();
    timer = setInterval(() => tryRegister(), INTERVAL_MS);

    // expose debug hook
    (window as any).__changeRoomWebmcp = {
      registry,
      setWorkflow: (s: WorkflowState) => {
        workflowRef.current = s;
        // Trigger a re-sync on the next poll tick
        sync();
      },
    };

    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
      abortRef.current?.abort();
      registryRef.current = null;
      delete (window as any).__changeRoomWebmcp;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 2. Poll session + dynamic sync ────────────────────────────────────
  async function sync() {
    const registry = registryRef.current;
    if (!registry) return;

    try {
      const res = await fetch("/api/session", { cache: "no-store" });
      const json = await res.json();
      const state = json.view?.workflow as WorkflowState | undefined;
      if (!state) return;

      if (state !== workflowRef.current) {
        workflowRef.current = state;
      }

      // Use registry.discover() — already encodes static state + authority gates
      const desired = registry
        .discover()
        .filter((t) => t.available)
        .map((t) => t.name);

      // Delegate add/remove to syncRegisteredTools; browser fires toolchange natively
      const result = await syncRegisteredTools(registry, desired);

      if (result.errors.length > 0) {
        for (const e of result.errors) {
          // eslint-disable-next-line no-console
          console.warn(
            `[Change Room] WebMCP tool sync error for '${e.name}':`,
            e.error,
          );
        }
      }
    } catch {
      // Transient poll failure — ignore
    }
  }

  useEffect(() => {
    const t = setInterval(sync, 2000);
    sync();
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
