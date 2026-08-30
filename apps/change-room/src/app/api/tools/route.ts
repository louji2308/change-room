import { NextRequest, NextResponse } from "next/server";
import { WebmcpRegistry, TOOLS } from "@change-room/webmcp";
import type { ToolName } from "@change-room/domain";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * POST /api/tools — invoke a Change Room semantic tool. Enforcement (schema,
 * workflow-state availability, read-only, Change Control for mutations) happens
 * through the WebMCP registry + the session's tool runtime, exactly as it would
 * for a WebMCP host. Blind-safe: no ground truth is ever returned.
 */
export async function POST(req: NextRequest) {
  const session = getSession();
  let body: { name?: string; args?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const name = body.name as ToolName;
  if (!name || !TOOLS.some((t) => t.name === name)) {
    return NextResponse.json({ ok: false, error: `unknown tool: ${name}` }, { status: 400 });
  }
  const registry = new WebmcpRegistry(session.asToolRuntime);
  const res = await registry.invoke(name, body.args);
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error, validation: res.validation }, { status: 422 });
  }
  return NextResponse.json({ ok: true, data: res.data });
}
