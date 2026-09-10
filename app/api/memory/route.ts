import { NextResponse } from "next/server";

import { isRequestAuthed } from "@/lib/dashboard/auth";
import {
  fetchMemoryOverview,
  resolveAgentNamespace,
} from "@/lib/dashboard/memory";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await isRequestAuthed()))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const explicitNs = searchParams.get("namespace");
  const agent = searchParams.get("agent");

  // Explicit namespace wins. Otherwise, when an agent pubkey is given, map it to
  // the namespace it owns. With neither, fall back to the local default.
  let namespace = explicitNs ?? undefined;
  if (!namespace && agent) {
    const resolved = await resolveAgentNamespace(agent);
    if (!resolved) {
      return NextResponse.json({ error: "no-namespace", agent });
    }
    namespace = resolved;
  }

  return NextResponse.json(await fetchMemoryOverview(namespace));
}
