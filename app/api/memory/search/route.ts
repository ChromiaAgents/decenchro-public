import { NextResponse } from "next/server";

import { isRequestAuthed } from "@/lib/dashboard/auth";
import { resolveAgentNamespace, searchMemory } from "@/lib/dashboard/memory";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isRequestAuthed()))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const explicitNs = searchParams.get("namespace");
  const agent = searchParams.get("agent");

  let namespace = explicitNs ?? undefined;
  if (!namespace && agent) {
    namespace = (await resolveAgentNamespace(agent)) ?? undefined;
  }

  return NextResponse.json(await searchMemory(q, 6, namespace));
}
