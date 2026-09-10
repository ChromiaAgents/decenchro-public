import { NextResponse } from "next/server";

import { deriveAgent } from "@/lib/dashboard/agents";
import { isRequestAdmin } from "@/lib/dashboard/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isRequestAdmin()))
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  let body: { key?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ valid: false }, { status: 400 });
  }
  return NextResponse.json(await deriveAgent(body.key ?? ""));
}
