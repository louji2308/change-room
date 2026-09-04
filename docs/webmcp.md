# WebMCP in Change Room

> WebMCP is **not the product**. It is the mechanism through which the web application exposes meaningful capabilities to an AI agent. Change Room treats it as the application's **agent capability interface** (`Project/Idea.md` §5).

The agent never gets raw power (no SQL tool, no shell tool, no arbitrary HTTP execution). It gets a small, distinct set of **semantic application capabilities** that are *state-aware*: which tools are invocable depends on the current workflow state, and every mutation passes through the Change Control layer.

## The tool surface

Fourteen tools, defined in `packages/webmcp/src/tools.ts`, grouped by intent:

| Group | Tools | readOnly |
|-------|-------|----------|
| observation | `inspect_system`, `investigate`, `get_evidence`, `inspect_history` | ✓ |
| decision | `generate_plans`, `compare_plans`, `simulate_plan`, `challenge_plan` | ✓ |
| control | `prepare_change`, `validate_policy`, `request_human_decision` | ✓ (creates no mutation) |
| action | `execute_change`, `rollback_change` | ✗ (real sandbox mutations) |
| verification | `verify_change` | ✓ (checks actual outcome, not just "executed OK") |

## How tools are registered

`packages/webmcp/src/registry.ts` defines `WebmcpRegistry`, the enforcement wrapper:

- `discover()` — lists every tool with description, input schema, `readOnly`, group, and **availability in the current workflow state**.
- `invoke(name, args)` — enforces, in order: tool-known → state-available → input-schema valid → runtime execution.
- `validate(name, args)` — strict schema validation (missing / unknown / wrong-type fields rejected).

`packages/webmcp/src/adapter.ts` is the browser adapter. It feature-detects the native WebMCP API on `document.modelContext`:

```ts
const controller = new AbortController();
document.modelContext.registerTool(
  { name, description, inputSchema, annotations },
  { signal: controller.signal }
);
```

The native surface is `registerTool(tool, {signal})`, `getTools()`, `executeTool(tool, inputObject)`, and `ontoolchange` / `addEventListener("toolchange")`.

Availability changes are implemented by changing the registered-tool set — tools that leave the allowed set are unregistered via their `AbortSignal`, and new tools are registered. The **browser itself** fires the native `toolchange` event when the set changes; the page does **not** call any `emitEvent` method.

If the host is absent (a regular browser), registration is a **safe no-op** and the app still works.

## How a WebMCP agent connects

There are two equivalent entry points; both funnel through the same `WebmcpRegistry` so enforcement is identical.

### 1. From inside a WebMCP-capable browser (the demo path)

1. Open the Change Room app at `http://localhost:3000`.
2. `apps/change-room/src/components/WebMCP.tsx` detects `document.modelContext`, registers currently-allowed tools, and keeps the native registered set in sync with the workflow state.
3. Tools that leave the allowed set are unregistered (via their `AbortSignal`), so `getTools()` always reflects the current capability surface.
4. Each registered tool's `execute` POSTs to the server endpoint `POST /api/tools` with `{ name, args }`.
5. The server runs the same `WebmcpRegistry` (via the session's tool runtime) so permission/state/schema rules always apply.

### 2. From a remote agent (HTTP)

Call the server endpoint directly. Discovery is best done by querying the tool list in `packages/webmcp/src/tools.ts` (or `GET /api/session` for the current workflow state).

```bash
# read-only observation — always available once a contract is set
curl -s -X POST http://localhost:3000/api/tools \
  -H "Content-Type: application/json" \
  -d '{"name":"inspect_system","args":{}}'

# investigate the incident
curl -s -X POST http://localhost:3000/api/tools \
  -H "Content-Type: application/json" \
  -d '{"name":"investigate","args":{"focus":"checkout"}}'
```

Responses are always `{ ok: true, data }` or `{ ok: false, error, validation? }` (HTTP 422 for validation failures). A tool invoked in the wrong workflow state returns an "not available in the current workflow state" error — the agent should re-discover availability rather than retry blindly.

A full workflow therefore looks like: `inspect_system → investigate → get_evidence → generate_plans → compare_plans → simulate_plan → prepare_change → validate_policy → request_human_decision → (human approves in the UI) → execute_change → verify_change`. Mutations (`execute_change`, `rollback_change`) also require approval authority from the Change Control layer — the agent cannot self-approve.

## Native deployment requirements

1. **Origin-keyed agent cluster:** The document must be served with `Origin-Agent-Cluster: ?1`. Without it, `registerTool`/`getTools`/`executeTool` are rejected with a `SecurityError`. This header is configured in `apps/change-room/next.config.js` and applied to all routes.
2. **`tools` Permissions Policy:** Registration is disabled by default in cross-origin iframes unless delegated via `allow="tools"`. For a top-level document, ensure no restrictive `Permissions-Policy` header blocks `tools`.

## Testing WebMCP

WebMCP is only exposed in WebMCP-capable clients. Ordinary Chrome does not expose `document.modelContext`.

1. **ChatGPT desktop app** → built-in browser → open the app URL → look for "Site Tools" in the chat interface.
2. **Chrome with WebMCP enabled** (origin trial or experimental flag) → open DevTools console → run:
   ```js
   typeof document.modelContext          // should be "object"
   await document.modelContext.getTools() // returns registered tools
   ```

## Safety rules

- **Blind mode:** no tool response ever contains seed, disturbance lists, scenario ids, or ground truth. The session guarantees this (`apps/change-room/src/lib/session.ts`).
- **State-aware:** `execute_change` is only available in `APPROVED`; `generate_plans` only while `INVESTIGATING`/`PLAN_READY`/`DEVIATION`, etc. (`packages/webmcp/src/tools.ts`, enforced via `domain.canToolInState`).
- **Read-only promises:** read-only tools never mutate. The only mutation tools are `execute_change` and `rollback_change`, and both route through the Change Control gate.

## Implementation anchor points

| Concern | Location |
|---------|----------|
| Tool definitions + state availability | `packages/webmcp/src/tools.ts` |
| Enforcement registry (`WebmcpRegistry`) | `packages/webmcp/src/registry.ts` |
| Browser registration + `getTools`/`executeTool`/`toolchange` | `packages/webmcp/src/adapter.ts` |
| Server tool endpoint | `apps/change-room/src/app/api/tools/route.ts` |
| Client adapter wiring | `apps/change-room/src/components/WebMCP.tsx` |
| Session tool runtime (`asToolRuntime`) | `apps/change-room/src/lib/session.ts` |
| Domain contracts (WorkflowState, ToolName) | `packages/domain/src/` |