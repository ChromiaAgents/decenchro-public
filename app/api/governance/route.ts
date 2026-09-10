import { NextResponse } from "next/server";

import { isRequestAuthed } from "@/lib/dashboard/auth";
import { fetchGovernance } from "@/lib/dashboard/governance";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isRequestAuthed())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const data = await fetchGovernance();
  return NextResponse.json(data);
}
