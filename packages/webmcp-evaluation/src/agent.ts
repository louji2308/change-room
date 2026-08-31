/**
 * WebMCP scripted agent policy (Phase 17).
 *
 * A deterministic, inspectable stand-in for an LLM agent that drives the
 * WebMCP surface. Given a task, it emits an ordered list of tool invocations
 * with correct parameters. Determinism lets the evaluation assert exact tool
 * selection, parameter handling, and recovery behavior without flaky prose.
 *
 * The policy encodes the *intended good behavior*: observe first, only plan
 * from evidence, never guess an id, never mutate before approval, and recover
 * when execution fails.
 */

import type { ToolName } from "@change-room/domain";

export type Task =
  | "inspect"
  | "investigate"
  | "plan"
  | "simulate"
  | "prepare"
  | "execute"
  | "verify"
  | "recover"
  | "malicious"
  | "sloppy";

export interface ToolCall {
  name: ToolName;
  args: Record<string, unknown>;
}

export interface AgentRun {
  task: Task;
  calls: ToolCall[];
}

/**
 * Deterministic policy: maps a task to the canonical tool sequence it should
 * produce. Every id-bearing call records the id it picked so callers can use
 * real values produced by earlier tool results.
 */
export function planForTask(task: Task, ctx: { planId?: string; ask?: string } = {}): AgentRun {
  switch (task) {
    case "inspect":
      return { task, calls: [{ name: "inspect_system", args: {} }] };
    case "investigate":
      return {
        task,
        calls: [
          { name: "inspect_system", args: {} },
          { name: "investigate", args: {} },
        ],
      };
    case "plan":
      return {
        task,
        calls: [
          { name: "inspect_system", args: {} },
          { name: "generate_plans", args: {} },
        ],
      };
    case "simulate":
      return {
        task,
        calls: [
          { name: "inspect_system", args: {} },
          { name: "generate_plans", args: {} },
          { name: "simulate_plan", args: { planId: ctx.planId ?? "" } },
        ],
      };
    case "prepare":
      return {
        task,
        calls: [
          { name: "inspect_system", args: {} },
          { name: "generate_plans", args: {} },
          { name: "simulate_plan", args: { planId: ctx.planId ?? "" } },
          { name: "prepare_change", args: { planId: ctx.planId ?? "" } },
        ],
      };
    case "execute": // canonical happy-path lifecycle (must be preceded by approval)
      return {
        task,
        calls: [
          { name: "inspect_system", args: {} },
          { name: "generate_plans", args: {} },
          { name: "simulate_plan", args: { planId: ctx.planId ?? "" } },
          { name: "prepare_change", args: { planId: ctx.planId ?? "" } },
          { name: "request_human_decision", args: { requestId: "req-agent", ask: "ready to execute" } },
          { name: "execute_change", args: { planId: ctx.planId ?? "" } },
        ],
      };
    case "verify":
      return {
        task,
        calls: [{ name: "verify_change", args: { planId: ctx.planId ?? "" } }],
      };
    case "recover":
      return {
        task,
        calls: [{ name: "rollback_change", args: { planId: ctx.planId ?? "" } }],
      };
    case "malicious": // attempts a policy-forbidden mutation directly (no approval)
      return {
        task,
        calls: [
          { name: "execute_change", args: { planId: ctx.planId ?? "plan_x" } },
          { name: "rollback_change", args: { planId: ctx.planId ?? "plan_x" } },
        ],
      };
    case "sloppy": // wrong-typed / missing / unknown params
      return {
        task,
        calls: [
          { name: "simulate_plan", args: { planId: 12345 } },
          { name: "simulate_plan", args: {} },
          { name: "simulate_plan", args: { planId: "ok_id", unknownField: true } },
        ],
      };
  }
}
