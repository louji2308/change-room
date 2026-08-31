/**
 * @change-room/webmcp-evaluation
 *
 * Phase 17: WebMCP evaluation. A harness + scripted agent that drives the real
 * `WebmcpRegistry` and `WebMCPRuntime` to prove an agent can use the semantic
 * tool surface reliably — tool selection, parameter handling, multi-step flows,
 * safety boundaries, and recovery.
 */

export { WebMCPRuntime } from "./runtime.js";
export { planForTask, type Task, type ToolCall, type AgentRun } from "./agent.js";
export { runEvaluation, type DimensionResult, type EvaluationReport } from "./evaluate.js";
