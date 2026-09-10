import { NextResponse } from "next/server";

import { isRequestAuthed } from "@/lib/dashboard/auth";
import { fetchDecision } from "@/lib/dashboard/decision";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isRequestAuthed()))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const decision = await fetchDecision(id);
  return NextResponse.json(decision);
}
