import { NextResponse } from "next/server";

import { isRequestAdmin, isRequestAuthed } from "@/lib/dashboard/auth";
import {
  MANAGED_KEYS,
  type ManagedKey,
  getPresence,
  upsertKeys,
} from "@/lib/dashboard/env-rw";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "unauthorized" } as const;
const FORBIDDEN = { error: "admin role required" } as const;

export async function GET() {
  if (!(await isRequestAuthed()))
    return NextResponse.json(UNAUTHORIZED, { status: 401 });
  const presence = await getPresence();
  return NextResponse.json({ presence });
}

export async function POST(req: Request) {
  if (!(await isRequestAdmin()))
    return NextResponse.json(FORBIDDEN, { status: 403 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "expected object" }, { status: 400 });
  }

  const updates: Partial<Record<ManagedKey, string>> = {};
  for (const key of MANAGED_KEYS) {
    const v = (body as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim().length > 0) updates[key] = v;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no managed keys provided" }, { status: 400 });
  }

  try {
    const result = await upsertKeys(updates);
    const presence = await getPresence();
    return NextResponse.json({ ok: true, ...result, presence });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "write failed" },
      { status: 500 },
    );
  }
}
