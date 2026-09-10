import { NextResponse } from "next/server";

import { auth, authConfigured } from "@/lib/auth/server";
import { ensureCompany } from "@/lib/dashboard/auth";

/**
 * Creates the signed-in user's company profile.
 *
 * On Supabase this was a database trigger: handle_new_user() fired on
 * auth.users insert and read company_name / company_description out of
 * raw_user_meta_data, so the app never inserted a company itself. Neon Auth owns
 * its own schema and we do not put triggers in it, so the signup form calls this
 * immediately after sign-up, once the session cookie exists.
 *
 * Idempotent: ensureCompany() no-ops when the user already has one, so a retry
 * after a failed first attempt is safe.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!authConfigured())
    return NextResponse.json({ error: "auth not configured" }, { status: 503 });

  const { data } = await auth().getSession();
  const user = data?.user;
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  let body: { name?: string; description?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  const description = (body.description ?? "").trim();
  // Same bounds as the CHECK constraints in db/migrations/0001_init.sql, so a
  // long paste fails here with a readable message instead of as a 500.
  if (name.length > 120)
    return NextResponse.json({ error: "Company name is too long." }, { status: 400 });
  if (description.length > 2000)
    return NextResponse.json({ error: "Company description is too long." }, { status: 400 });

  try {
    const companyId = await ensureCompany(user.id, user.email ?? null, name, description);
    return NextResponse.json({ ok: true, companyId });
  } catch (err) {
    console.error("[company] create failed", err);
    return NextResponse.json({ error: "Could not save your company." }, { status: 502 });
  }
}
