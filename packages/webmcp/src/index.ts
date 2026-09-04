/**
 * Change Room — WebMCP layer (Phase 7).
 *
 * Exposes the application's meaningful operational capabilities to an AI agent
 * as a small, distinct, state-aware tool surface. Reads are always safe; every
 * mutation is delegated to the Change Room runtime which enforces the Change
 * Control boundary.
 */

export { TOOLS, TOOL_NAMES, ALL_TOOLS, ALL_TOOL_NAMES, V2_TOOLS, V2_TOOL_NAMES, getTool, toolAvailableInState } from "./tools.js";
export type { ToolDefinition, ToolContext, WebmcpToolName, V2ToolName } from "./tools.js";
export { WebmcpRegistry, nativeAnnotations } from "./registry.js";
export type { ToolRuntime, InvocationResult } from "./registry.js";
export {
  registerWithWebmcp,
  /** @deprecated No-op — native browser fires `toolchange` events directly. Remove call sites. */
  emitToolChange,
  webmcpAvailable,
  syncRegisteredTools,
  getNativeTools,
  executeNativeTool,
} from "./adapter.js";
export {
  classifyContent,
  isTrustedAsInstruction,
  isUntrusted,
  isValidId,
  validateIdField,
  validateActionType,
  validateActor,
  validateParamInRange,
  ACTION_TYPE_ENUM,
  ACTOR_ENUM,
  PARAM_RANGES,
} from "./security.js";
export type { ContentClass } from "./security.js";
