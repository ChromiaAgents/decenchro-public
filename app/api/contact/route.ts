import { NextResponse } from "next/server";

import { db, dbConfigured } from "@/lib/db/client";
import { contact_submissions } from "@/db/schema";

export const dynamic = "force-dynamic";

// POST /api/contact — stores a "Contact us" submission in Supabase (the
// contact_submissions table, migration 0008). No email provider: the row is the
// record; view it in the Supabase table editor. No auth (public marketing form),
// so it's guarded by a honeypot and basic validation, and writes through the
// service-role client (RLS-protected table, service-role-only access).

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(req: Request) {
  let body: {
    name?: string;
    company?: string;
    email?: string;
    message?: string;
    subject?: string;
    website?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // Honeypot: a real user never fills this hidden field. Pretend success so bots
  // don't learn they were caught.
  if (body.website && body.website.trim()) {
    return NextResponse.json({ ok: true });
  }

  const name = (body.name ?? "").trim();
  const company = (body.company ?? "").trim();
  const email = (body.email ?? "").trim();
  const message = (body.message ?? "").trim();
  const subject = (body.subject ?? "").trim();

  if (!name || !email || !message)
    return NextResponse.json(
      { error: "Name, email, and your question are required." },
      { status: 400 },
    );
  if (!EMAIL_RE.test(email))
    return NextResponse.json({ error: "That email doesn't look right." }, { status: 400 });
  if (message.length > 5000)
    return NextResponse.json({ error: "Message is too long." }, { status: 400 });

  if (!dbConfigured())
    return NextResponse.json(
      { error: "Contact form is not configured yet." },
      { status: 503 },
    );

  try {
    await db().insert(contact_submissions).values({
      name,
      company: company || null,
      email,
      message,
      subject: subject || null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[contact] insert error", err);
    return NextResponse.json(
      { error: "Could not send right now. Please try again." },
      { status: 502 },
    );
  }
}
