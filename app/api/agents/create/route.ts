import { NextResponse } from "next/server";

import { isRequestAdmin } from "@/lib/dashboard/auth";
import { createAgentIdentity } from "@/lib/dashboard/agents";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!(await isRequestAdmin()))
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  const agent = await createAgentIdentity();
  return NextResponse.json(agent);
}
