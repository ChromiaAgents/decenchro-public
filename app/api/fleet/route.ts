import { NextResponse } from "next/server";

import { isRequestAuthed } from "@/lib/dashboard/auth";
import { fetchFleet } from "@/lib/dashboard/fleet";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isRequestAuthed()))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const data = await fetchFleet();
  return NextResponse.json(data);
}
