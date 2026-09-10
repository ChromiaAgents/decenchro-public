import { NextResponse } from "next/server";

import { getOwner, isRequestAuthed } from "@/lib/dashboard/auth";
import { getDeploymentRow } from "@/lib/dashboard/deployments";
import { decrypt } from "@/lib/dashboard/crypto";

export const dynamic = "force-dynamic";

// A bot's @handle never changes for a given token, so cache it for the process
// lifetime — the dashboard polls the fleet often and we don't want a getMe per
// poll. Keyed by deployment id.
const usernameCache = new Map<string, string>();

// GET /api/agents/telegram?id=<deploymentId> — the managed agent's Telegram bot
// @handle, so the Fleet card can link straight into the chat. Auth + ownership
// gated. Decrypts the stored token server-side to call getMe and returns only
// the public username; the token itself never leaves the server.
export async function GET(req: Request) {
  if (!(await isRequestAuthed()))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const owner = await getOwner();
  if (!owner)
    return NextResponse.json({ error: "no company profile" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id)
    return NextResponse.json({ error: "id required" }, { status: 400 });

  if (usernameCache.has(id))
    return NextResponse.json({ username: usernameCache.get(id) });

  const row = await getDeploymentRow(id);
  if (!row || row.company_id !== owner.companyId)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  let token: string;
  try {
    token = decrypt(row.telegram_token_enc);
  } catch {
    return NextResponse.json({ username: null });
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ username: null });
    const body = (await res.json()) as {
      ok?: boolean;
      result?: { username?: string };
    };
    const username = body?.ok ? body.result?.username ?? null : null;
    if (username) usernameCache.set(id, username);
    return NextResponse.json({ username });
  } catch {
    return NextResponse.json({ username: null });
  }
}
