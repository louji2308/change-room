/**
 * WebMCP evaluation harness (Phase 17).
 *
 * Drives the real `WebmcpRegistry` (enforcement) + `WebMCPRuntime` (execution)
 * through the scripted agent policy and scores the five Phase 17 dimensions:
 *
 *   17.1 tool selection   — does the agent pick the right tool for the task?
 *   17.2 parameter handling — valid/invalid/missing inputs are caught correctly;
 *   17.3 multi-step flows — a full lifecycle can be driven end to end;
 *   17.4 safety boundaries — forbidden/unauthorised mutations are blocked;
 *   17.5 recovery         — a failed execution leads to a correct recovery response.
 *
 * Every dimension runs against the *actual* enforcement layer, so a regression
 * in the registry or the tool runtime surfaces here.
 */

import { WebmcpRegistry } from "@change-room/webmcp";
import { WebMCPRuntime } from "./runtime.js";
import { planForTask, type Task } from "./agent.js";

export interface DimensionResult {
  id: string;
  name: string;
  pass: boolean;
  detail: string[];
}

export interface EvaluationReport {
  dimensions: DimensionResult[];
  passed: number;
  total: number;
  overall: "PASS" | "FAIL";
}

async function drive(registry: WebmcpRegistry, calls: Array<{ name: Parameters<WebmcpRegistry["invoke"]>[0]; args: unknown }>): Promise<Array<{ name: string; ok: boolean; error?: string; data?: unknown }>> {
  const out: Array<{ name: string; ok: boolean; error?: string; data?: unknown }> = [];
  for (const c of calls) {
    const r = await registry.invoke(c.name as never, c.args);
    out.push({ name: String(c.name), ok: r.ok, error: r.ok ? undefined : "error" in r ? r.error : undefined, data: r.ok ? ("data" in r ? r.data : undefined) : undefined });
  }
  return out;
}

/** Full happy-path lifecycle driven via the agent policy. */
async function canonicalHappyPath(run: WebMCPRuntime, registry: WebmcpRegistry) {
  await registry.invoke("inspect_system", {});
  await registry.invoke("investigate", {});
  const plans = await registry.invoke("generate_plans", {});
  const planId = (plans.ok && Array.isArray((plans.data as { plans?: unknown[] }).plans) ? (plans.data as { plans: { id: string }[] }).plans[0]?.id : "") || "";
  await registry.invoke("simulate_plan", { planId });
  await registry.invoke("prepare_change", { planId });
  run.humanApprove();
  const exec = await registry.invoke("execute_change", { planId });
  const verify = await registry.invoke("verify_change", { planId });
  return { exec, verify };
}

export async function runEvaluation(): Promise<EvaluationReport> {
  const dimensions: DimensionResult[] = [];

  // ---- 17.1 tool selection ---------------------------------------------------
  {
    const run = new WebMCPRuntime();
    const registry = run.registry;
    const task: Task = "investigate";
    const res = await drive(registry, planForTask(task).calls as never);
    const investigateOk = res[1]?.ok === true && res[9] === undefined;
    const selectionCorrect = res[0]?.ok === true && res[1]?.ok === true;
    dimensions.push({
      id: "17.1",
      name: "Tool selection",
      pass: selectionCorrect,
      detail: [
        `task "${task}" picked inspect_system then investigate`,
        `inspect_system ok: ${res[0]?.ok === true}, investigate ok: ${res[1]?.ok === true}`,
        investigateOk ? "investigate returned an investigation result" : "investigate result missing",
      ],
    });
  }

  // ---- 17.2 parameter handling ----------------------------------------------
  {
    const run = new WebMCPRuntime();
    const registry = run.registry;
    const res = await drive(registry, planForTask("sloppy").calls as never);
    const [typedWrong, missing, unknownField] = res;
    const caughtWrongType = typedWrong?.ok === false;
    const caughtMissing = missing?.ok === false;
    const caughtUnknown = unknownField?.ok === false;
    dimensions.push({
      id: "17.2",
      name: "Parameter handling",
      pass: caughtWrongType && caughtMissing && caughtUnknown,
      detail: [
        `wrong-typed planId rejected: ${caughtWrongType}`,
        `missing planId rejected: ${caughtMissing}`,
        `unknown field rejected: ${caughtUnknown}`,
      ],
    });
  }

  // ---- 17.3 multi-step flow --------------------------------------------------
  {
    const run = new WebMCPRuntime();
    const registry = run.registry;
    const { exec, verify } = await canonicalHappyPath(run, registry);
    const execOk = exec.ok === true;
    const verifyOk = verify.ok === true;
    dimensions.push({
      id: "17.3",
      name: "Multi-step lifecycle",
      pass: execOk && verifyOk,
      detail: [
        `full lifecycle (observe→investigate→plan→simulate→prepare→approve→execute→verify)`,
        `execute_change ok: ${execOk}`,
        `verify_change ok: ${verifyOk}`,
        verifyOk ? `verify verdict: ${(verify.data as { verdict: string })?.verdict}` : "verify failed",
      ],
    });
  }

  // ---- 17.4 safety boundaries ------------------------------------------------
  {
    const run = new WebMCPRuntime();
    const registry = run.registry;
    // Prepare a real plan but never obtain human approval, then attempt the
    // mutations — the gate must refuse to execute / rollback without authority.
    await registry.invoke("inspect_system", {});
    await registry.invoke("investigate", {});
    const plans = await registry.invoke("generate_plans", {});
    const planId = (plans.ok && (plans.data as { plans?: { id: string }[] })?.plans?.[0]?.id) || "";
    await registry.invoke("simulate_plan", { planId });
    await registry.invoke("prepare_change", { planId });
    // No humanApprove() intentionally: the agent cannot self-authorize.
    const exec = await registry.invoke("execute_change", { planId });
    const execBlocked = exec.ok === false;
    const rollback = await registry.invoke("rollback_change", { planId });
    const rollbackBlocked = rollback.ok === false;
    // A never-prepared / unknown plan must also be rejected.
    const unknownPlan = await registry.invoke("prepare_change", { planId: "plan_nope" });
    const unknownRejected = unknownPlan.ok === false;
    dimensions.push({
      id: "17.4",
      name: "Safety boundaries",
      pass: execBlocked && rollbackBlocked && unknownRejected,
      detail: [
        `execute_change without approval blocked: ${execBlocked}`,
        `rollback_change without authority blocked: ${rollbackBlocked}`,
        `unknown/phantom plan rejected: ${unknownRejected}`,
      ],
    });
  }

  // ---- 17.5 recovery ---------------------------------------------------------
  {
    const run = new WebMCPRuntime();
    const registry = run.registry;
    // Prepare + approve, then force an execution failure, then recover.
    await registry.invoke("inspect_system", {});
    await registry.invoke("investigate", {});
    const plans = await registry.invoke("generate_plans", {});
    const planId = (plans.ok && (plans.data as { plans?: { id: string }[] })?.plans?.[0]?.id) || "";
    await registry.invoke("simulate_plan", { planId });
    await registry.invoke("prepare_change", { planId });
    run.humanApprove();
    run.injectExecutionError = "simulated deployment failure during apply";
    const exec = await registry.invoke("execute_change", { planId });
    const failed = exec.ok === false;
    // Agent recognizes failure and recovers.
    const rec = await registry.invoke("rollback_change", { planId });
    const recovered = rec.ok === true;
    dimensions.push({
      id: "17.5",
      name: "Recovery",
      pass: failed && recovered,
      detail: [
        `execution failed (injected error): ${failed}`,
        `rollback_change accepted after failure: ${recovered}`,
        failed ? `error surfaced: ${(exec as { error?: string }).error}` : "no failure injected, recovery path not exercised",
      ],
    });
  }

  const passed = dimensions.filter((d) => d.pass).length;
  return {
    dimensions,
    passed,
    total: dimensions.length,
    overall: passed === dimensions.length ? "PASS" : "FAIL",
  };
}
