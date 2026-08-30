"use client";

import { useEffect, useRef } from "react";
import { WebmcpRegistry, registerWithWebmcp, emitToolChange } from "@change-room/webmcp";
import { TOOLS } from "@change-room/webmcp";
import type { ToolName, WorkflowState } from "@change-room/domain";

/**
 * Registers Change Room's semantic tool surface with a WebMCP host in the
 * browser (feature-detected: `document.modelContext`). Each tool's `execute`
 * is forwarded to the server `/api/tools` endpoint, which enforces schema,
 * workflow-state availability and the Change Control boundary — identical to
 * the in-page runtime. Availability changes are broadcast via `toolchange`.
 *
 * When the host is absent (regular browser), this is a safe no-op.
 */
export default function WebMCP() {
  const workflowRef = useRef<WorkflowState>("IDLE");
  const registeredRef = useRef(false);

  useEffect(() => {
    if (typeof document === "undefined" || !(document as any).modelContext) return;
    let disposed = false;

    const runtime = {
      workflowState: () => workflowRef.current,
      execute: async (name: ToolName, args: Record<string, unknown>) => {
        const res = await fetch("/api/tools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, args }),
        });
        const json = await res.json();
        if (!res.ok) return { ok: false, error: json.error, validation: json.validation };
        return { ok: true, data: json.data };
      },
    };

    const registry = new WebmcpRegistry(runtime);
    registerWithWebmcp(registry).then((names) => {
      if (!disposed && names.length > 0) {
        registeredRef.current = true;
        // announce current availability after registration
        emitToolChange();
        // eslint-disable-next-line no-console
        console.info(`[Change Room] registered ${names.length} WebMCP tools`);
      }
    });

    // expose a small debug hook for DevTools evaluation
    (window as any).__changeRoomWebmcp = {
      tools: TOOLS,
      registry,
      setWorkflow: (s: WorkflowState) => {
        workflowRef.current = s;
        emitToolChange();
      },
    };

    return () => {
      disposed = true;
      delete (window as any).__changeRoomWebmcp;
    };
  }, []);

  // Sync the current workflow state into the ref so `toolchange` reflects it.
  useEffect(() => {
    async function sync() {
      try {
        const res = await fetch("/api/session", { cache: "no-store" });
        const json = await res.json();
        const state = json.view?.workflow as WorkflowState | undefined;
        if (state && state !== workflowRef.current) {
          workflowRef.current = state;
          emitToolChange();
        }
      } catch {
        // ignore transient poll failures
      }
    }
    const t = setInterval(sync, 2000);
    sync();
    return () => clearInterval(t);
  }, []);

  return null;
}
