import { NextResponse } from "next/server";

import { isRequestAuthed } from "@/lib/dashboard/auth";
import { fetchReplay, listSessions } from "@/lib/dashboard/sessions";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isRequestAuthed()))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const file = new URL(req.url).searchParams.get("file");
  if (file) {
    const replay = await fetchReplay(file);
    return NextResponse.json(replay);
  }
  const sessions = await listSessions();
  return NextResponse.json({ sessions });
}
