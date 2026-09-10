import { NextResponse } from "next/server";

import { getCompanyName, getSession } from "@/lib/dashboard/auth";

/**
 * Session + company for the marketing nav.
 *
 * Replaces the browser reading the `companies` table with the Supabase anon key
 * and trusting row-level security to scope it. There is no RLS on Neon and no
 * browser database access at all now, so the nav asks the server instead.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ email: null, company: null });
  const company = await getCompanyName();
  return NextResponse.json({ email: session.user, company });
}
