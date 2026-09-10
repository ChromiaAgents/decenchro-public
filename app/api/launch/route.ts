import { NextResponse } from "next/server";

import { isRequestAdmin, isRequestAuthed } from "@/lib/dashboard/auth";
import { getPresence } from "@/lib/dashboard/env-rw";
import {
  getStatus,
  launch,
  launchLogPath,
  stop,
  tailLog,
} from "@/lib/dashboard/hermes-control";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "unauthorized" } as const;

export async function GET() {
  if (!(await isRequestAuthed()))
    return NextResponse.json(UNAUTHORIZED, { status: 401 });
  const status = await getStatus();
  const log = await tailLog();
  return NextResponse.json({ status, logPath: launchLogPath, log });
}

export async function POST(req: Request) {
  if (!(await isRequestAdmin()))
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  let body: { action?: string } = {};
  try {
    body = await req.json();
  } catch {
    // no body is fine; default action handled below
  }
  const action = body.action ?? "start";

  if (action === "stop") {
    const result = await stop();
    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason, status: result.status },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, status: result.status });
  }

  if (action !== "start") {
    return NextResponse.json(
      { error: "unknown action; expected start|stop" },
      { status: 400 },
    );
  }

  // Pre-flight: refuse to launch without the three keys; OpenRouter is
  // mandatory (the agent can't talk), the other two are required by the
  // Telegram + Atbash surfaces we ship.
  const presence = await getPresence();
  const missing = (
    ["OPENROUTER_API_KEY", "TELEGRAM_BOT_TOKEN", "ATBASH_AGENT_KEY"] as const
  ).filter((k) => presence[k] !== "present");
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: "missing required keys",
        missing,
      },
      { status: 400 },
    );
  }

  try {
    const status = await launch();
    return NextResponse.json({ ok: true, status, logPath: launchLogPath });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "launch failed" },
      { status: 500 },
    );
  }
}
