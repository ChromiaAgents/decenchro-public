import { NextResponse } from "next/server";

import { fetchAnalytics } from "@/lib/dashboard/analytics";
import { isRequestAuthed } from "@/lib/dashboard/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isRequestAuthed()))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const data = await fetchAnalytics();
  return NextResponse.json(data);
}
