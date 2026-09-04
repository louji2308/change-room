import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * GET /health — Render application-level health check. Lightweight, always
 * returns ok once the Next.js server is up, so Render's HTTP health check can
 * keep the instance healthy without touching the live session or real stack.
 */
export async function GET() {
  return NextResponse.json({ ok: true });
}
