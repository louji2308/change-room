import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { SCENARIOS, listScenarios } from "@change-room/scenarios";

export const runtime = "nodejs";

/** GET /api/session — current blind-safe view plus available scenarios. */
export async function GET() {
  const session = getSession();
  const view = session.view();
  const scenarios = listScenarios().map((id) => {
    const def = SCENARIOS.find((s) => s.id === id);
    return { id, name: def?.name, description: def?.description, difficulty: def?.difficulty };
  });
  return NextResponse.json({ ok: true, view, scenarios });
}

/** POST /api/session — drive the operational workflow via an `action`. */
export async function POST(req: NextRequest) {
  const session = getSession();
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // body-less POST is fine (some actions need none)
  }
  const action = typeof body.action === "string" ? body.action : "";

  try {
    switch (action) {
      case "start": {
        const id = typeof body.scenarioId === "string" ? body.scenarioId : "cache-failure";
        if (process.env.REAL_MEDUSA === "1") {
          const name = typeof body.scenarioId === "string" ? body.scenarioId : "live-medusa";
          await session.startRealWorld(name);
        } else {
          session.startScenario(id);
        }
        return NextResponse.json({ ok: true, view: session.view() });
      }
      case "reset":
        session.reset();
        return NextResponse.json({ ok: true, view: session.view() });
      case "reason": {
        const goal = typeof body.goal === "string" ? body.goal : "restore system health";
        const result = session.reason(goal);
        return NextResponse.json({ ok: true, result, view: session.view() });
      }
      case "select": {
        session.selectPlan(String(body.planId));
        return NextResponse.json({ ok: true, view: session.view() });
      }
      case "prepare": {
        const gate = session.prepareChange();
        return NextResponse.json({ ok: true, gate, view: session.view() });
      }
      case "approve":
        return NextResponse.json({ ok: true, gate: session.approve(), view: session.view() });
      case "reject": {
        session.reject(typeof body.reason === "string" ? body.reason : "rejected by human");
        return NextResponse.json({ ok: true, view: session.view() });
      }
      case "execute": {
        const res = session.executeChange();
        return NextResponse.json({ ok: true, execution: res, view: session.view() });
      }
      case "verify": {
        const res = session.verifyChange();
        return NextResponse.json({ ok: true, verification: res, view: session.view() });
      }
      case "rollback": {
        session.rollbackChange();
        return NextResponse.json({ ok: true, view: session.view() });
      }
      case "request_decision": {
        const res = session.requestHumanDecision(typeof body.ask === "string" ? body.ask : "agent requests a decision");
        return NextResponse.json({ ok: true, request: res, view: session.view() });
      }
      // Phase 12 — bounded delegation + human takeover
      case "delegate": {
        const grant = session.grantDelegation({
          riskCeiling: (body.riskCeiling as "low" | "medium" | "high") ?? "medium",
          durationMs: Number(body.durationMs ?? 600000),
          scope: Array.isArray(body.scope) ? (body.scope as string[]) : ["cache", "database", "configuration", "checkout", "api-gateway", "queue"],
          approvalStillRequired: body.approvalStillRequired !== false,
          reversibleOnly: body.reversibleOnly !== false,
        });
        return NextResponse.json({ ok: true, delegation: grant, view: session.view() });
      }
      case "revoke_delegation": {
        session.revokeDelegation();
        return NextResponse.json({ ok: true, view: session.view() });
      }
      case "pause":
        session.pauseAgent();
        return NextResponse.json({ ok: true, view: session.view() });
      case "resume": {
        const res = session.resumeAgent();
        return NextResponse.json({ ok: true, result: res, view: session.view() });
      }
      case "takeover": {
        const res = session.humanTakeover(
          (body.actionType as import("@change-room/simulator").ActionType) ?? "restore_configuration",
          (body.params as Record<string, number | string>) ?? {},
          typeof body.note === "string" ? body.note : "human modified the system manually"
        );
        return NextResponse.json({ ok: true, takeover: res, view: session.view() });
      }
      default:
        return NextResponse.json({ ok: false, error: `unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code;
    return NextResponse.json({ ok: false, error: msg, code }, { status: 409 });
  }
}
