import { NextResponse } from "next/server";

import { isRequestAdmin, isRequestAuthed } from "@/lib/dashboard/auth";
import {
  type AgentConfigUpdate,
  readAgentConfig,
  writeAgentConfig,
} from "@/lib/dashboard/agent-config";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "unauthorized" } as const;

// No `brain`: the model is fixed fleet-wide, so it is not a field a tenant can
// set. A request naming it is ignored rather than rejected, since an older
// client sending it should not have its other fields fail with it.
const ALLOWED = {
  autonomy: new Set(["ask", "judgment", "auto"]),
  newUsers: new Set(["approve", "allow", "block"]),
  audit: new Set(["strict", "standard", "permissive"]),
} as const;

export async function GET() {
  if (!(await isRequestAuthed()))
    return NextResponse.json(UNAUTHORIZED, { status: 401 });
  const config = await readAgentConfig();
  return NextResponse.json({ config });
}

export async function POST(req: Request) {
  if (!(await isRequestAdmin()))
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "expected object" }, { status: 400 });
  }

  const upd: AgentConfigUpdate = {};
  const b = body as Record<string, unknown>;
  for (const k of ["autonomy", "newUsers", "audit"] as const) {
    const v = b[k];
    if (typeof v !== "string") continue;
    if (!ALLOWED[k].has(v as never)) {
      return NextResponse.json(
        { error: `invalid value for ${k}: ${v}` },
        { status: 400 },
      );
    }
    // narrow per-field
    if (k === "autonomy") upd.autonomy = v as AgentConfigUpdate["autonomy"];
    else if (k === "newUsers") upd.newUsers = v as AgentConfigUpdate["newUsers"];
    else if (k === "audit") upd.audit = v as AgentConfigUpdate["audit"];
  }
  if (Object.keys(upd).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  try {
    const result = await writeAgentConfig(upd);
    const config = await readAgentConfig();
    return NextResponse.json({ ok: true, ...result, config });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "write failed" },
      { status: 500 },
    );
  }
}
