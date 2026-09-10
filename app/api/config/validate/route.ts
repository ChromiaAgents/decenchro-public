import { NextResponse } from "next/server";

import { isRequestAdmin } from "@/lib/dashboard/auth";
import { validateOpenRouterKey } from "@/lib/dashboard/openrouter";
import { validateBotToken } from "@/lib/dashboard/telegram";

export const dynamic = "force-dynamic";

// Live-checks a pasted credential before it's saved, so the operator sees a
// ✓/✗ inline. Admin-only; the pasted value is sent to the provider for the
// check and never logged or persisted here.
export async function POST(req: Request) {
  if (!(await isRequestAdmin()))
    return NextResponse.json({ error: "admin role required" }, { status: 403 });

  let body: { key?: string; value?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ valid: false }, { status: 400 });
  }

  const value = typeof body.value === "string" ? body.value : "";
  switch (body.key) {
    case "OPENROUTER_API_KEY":
      return NextResponse.json(await validateOpenRouterKey(value));
    case "TELEGRAM_BOT_TOKEN":
      return NextResponse.json(await validateBotToken(value));
    default:
      // No live check for this key — treat as not-validatable.
      return NextResponse.json({ valid: false, detail: "unsupported" });
  }
}
