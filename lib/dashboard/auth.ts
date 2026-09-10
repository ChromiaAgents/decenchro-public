import "server-only";

import { cache } from "react";

import { and, eq, ne, sql } from "drizzle-orm";

import { auth, authConfigured } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { companies, deployments } from "@/db/schema";

/**
 * Control-plane authentication, backed by Neon Auth (Managed Better Auth).
 *
 * Any signed-in user can reach the operator console. Mutating actions (deploy,
 * create agent, config writes) additionally require the "admin" role. Admins are
 * determined by DASHBOARD_ADMIN_EMAILS — a comma-separated allowlist of emails.
 * When that env var is unset every authenticated user is treated as admin, which
 * keeps local/demo use frictionless while letting production lock writes to a
 * known set of operators. That has nothing to do with the auth provider and did
 * not change in the migration.
 *
 * Dev escape hatch: with auth unconfigured (no env), auth is disabled and every
 * request resolves to a dev admin so local dev stays unlocked.
 */

export type Role = "admin" | "viewer";
export type Session = { user: string; role: Role };

const DEV_SESSION: Session = { user: "dev", role: "admin" };

/**
 * Local-only admin bypass. With DEV_AUTH_BYPASS=1 every request resolves to a
 * seeded dev admin, so the console can be driven end-to-end without a login.
 * HARD-GUARDED so it can never fire in production or on Vercel — the two extra
 * checks mean a stray env var in a real deploy is inert. Point it at a real
 * seeded user + company with DEV_BYPASS_USER_ID / DEV_BYPASS_EMAIL (run
 * `node scripts/seed-dev-user.mjs`).
 */
function devBypass(): boolean {
  return (
    process.env.DEV_AUTH_BYPASS === "1" &&
    process.env.NODE_ENV !== "production" &&
    process.env.VERCEL !== "1"
  );
}

function adminEmails(): string[] {
  return (process.env.DASHBOARD_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function roleFor(email: string | undefined): Role {
  const allow = adminEmails();
  // No allowlist configured → every authenticated user is an admin.
  if (allow.length === 0) return "admin";
  return email && allow.includes(email.toLowerCase()) ? "admin" : "viewer";
}

/** Auth is "enabled" whenever Neon Auth is configured. */
export function authEnabled(): boolean {
  return authConfigured();
}

/**
 * One verified user, and one resolved company, per request.
 *
 * auth().getSession() is a network round trip to the Neon Auth server, and a
 * single polled endpoint used to pay for it twice: once through isRequestAuthed
 * and again through getOwner. The dashboard layout paid a third time through
 * getCompanyName. At a 60 second poll across several streams that dominated the
 * auth call volume.
 *
 * cache() scopes a result to the request, so every helper below shares one round
 * trip. Neither value can change inside a request, so there is nothing to
 * invalidate. This is deduplication, not caching across requests: the session is
 * still verified on every request. (Carried over from the Supabase version,
 * where the same problem existed with supabase.auth.getUser().)
 */
const currentUser = cache(
  async (): Promise<{
    id: string;
    email: string | null;
    name: string | null;
  } | null> => {
    const { data } = await auth().getSession();
    const user = data?.user;
    if (!user) return null;
    // `name` is only used to title a company created on first sight, below.
    return { id: user.id, email: user.email ?? null, name: user.name ?? null };
  },
);

export async function getSession(): Promise<Session | null> {
  if (devBypass())
    return { user: process.env.DEV_BYPASS_EMAIL ?? "dev-admin", role: "admin" };
  if (!authConfigured()) return DEV_SESSION;
  const user = await currentUser();
  if (!user) return null;
  return { user: user.email ?? user.id, role: roleFor(user.email ?? undefined) };
}

/**
 * Resolve the company this user owns, adopting a pre-migration row if that is
 * what their email matches.
 *
 * The 25 accounts that came over from Supabase have a companies row whose
 * owner_id is their old Supabase uuid — Neon Auth issued them a new one, and
 * Supabase's bcrypt hashes could not be imported, so the only thing that
 * survived the move is the email address. On the first sign-in after the
 * cutover, this re-points the company (and its deployments) at the new id.
 *
 * Runs inside one transaction so a company can never end up re-owned while its
 * agents still answer to the old id. Idempotent: once owner_id matches, the
 * update is skipped and this is a single indexed read.
 */
const resolveCompanyId = cache(async (
  userId: string,
  email: string | null,
  name: string | null,
): Promise<string | null> => {
  const [owned] = await db()
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.owner_id, userId))
    .limit(1);
  if (owned) return owned.id;

  if (!email) return null;

  const [byEmail] = await db()
    .select({ id: companies.id, owner_id: companies.owner_id })
    .from(companies)
    .where(eq(sql`lower(${companies.owner_email})`, email.toLowerCase()))
    .limit(1);
  // Nobody to adopt: this is a brand-new account, so give it a company here.
  //
  // Signup through the form posts /api/company itself, but Google (and any
  // future provider) lands straight on the dashboard without ever passing
  // through that form, so those accounts had a session and no company: every
  // dashboard route answered `{"error":"unauthorized"}` from getOwner(). Under
  // Supabase the handle_new_user trigger covered every path at once; this is
  // the app-side equivalent, at the one place all of them funnel through.
  //
  // Idempotent on owner_id, so two concurrent first requests cannot make two
  // companies. The name is the provider's display name when it gave one; the
  // operator can rename it, and an email local part beats "Untitled company".
  if (!byEmail) {
    const fallback = name?.trim() || email.split("@")[0];
    try {
      const created = await ensureCompany(userId, email, fallback);
      console.log(`[AUDIT] company ${created} created for new user ${userId}`);
      return created;
    } catch (err) {
      console.error("[auth] could not create a company on first sight", err);
      return null;
    }
  }

  await db().transaction(async (tx) => {
    await tx.update(companies).set({ owner_id: userId }).where(eq(companies.id, byEmail.id));
    await tx
      .update(deployments)
      .set({ owner_id: userId })
      .where(
        and(eq(deployments.company_id, byEmail.id), ne(deployments.owner_id, userId)),
      );
  });
  console.log(`[AUDIT] company ${byEmail.id} adopted by neon-auth user ${userId}`);
  return byEmail.id;
});

/** The signed-in user's registered company name, if any. */
export async function getCompanyName(): Promise<string | null> {
  if (devBypass()) {
    const uid = process.env.DEV_BYPASS_USER_ID;
    if (!uid) return "Dev Workspace";
    const [row] = await db()
      .select({ name: companies.name })
      .from(companies)
      .where(eq(companies.owner_id, uid))
      .limit(1);
    return row?.name ?? "Dev Workspace";
  }
  if (!authConfigured()) return null;
  const user = await currentUser();
  if (!user) return null;
  const companyId = await resolveCompanyId(user.id, user.email, user.name);
  if (!companyId) return null;
  const [row] = await db()
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  return row?.name ?? null;
}

export async function isRequestAuthed(): Promise<boolean> {
  return (await getSession()) !== null;
}

export async function isRequestAdmin(): Promise<boolean> {
  return (await getSession())?.role === "admin";
}

/**
 * The caller's identity for ownership checks in the deployment control plane:
 * their auth user id, email, and company id (the tenant that owns deployments).
 * Returns null when unauthenticated. With auth unconfigured (local dev) the ids
 * are a stable dev sentinel so the flow stays exercisable offline.
 *
 * Since the move off Supabase this is the ONLY thing scoping a tenant's data:
 * row-level security did not come to Neon, so every route must keep comparing
 * row.company_id against this companyId.
 */
export type Owner = { userId: string; email: string | null; companyId: string };

export async function getOwner(): Promise<Owner | null> {
  if (devBypass()) {
    // Resolve the seeded dev user's real company id so ownership checks and the
    // deployments rows line up with a genuine record.
    const uid = process.env.DEV_BYPASS_USER_ID;
    if (!uid) return null;
    const [row] = await db()
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.owner_id, uid))
      .limit(1);
    if (!row?.id) return null; // bypass on but not seeded — surface it
    return {
      userId: uid,
      email: process.env.DEV_BYPASS_EMAIL ?? null,
      companyId: row.id,
    };
  }
  if (!authConfigured()) {
    return { userId: "dev", email: "dev", companyId: "dev" };
  }
  const user = await currentUser();
  if (!user) return null;
  const companyId = await resolveCompanyId(user.id, user.email, user.name);
  if (!companyId) return null; // signed in but no company profile yet
  return { userId: user.id, email: user.email, companyId };
}

/**
 * Create the company row for a brand-new signup.
 *
 * On Supabase this was a SECURITY DEFINER trigger on auth.users
 * (handle_new_user) reading raw_user_meta_data — the app never inserted a
 * company itself. Neon Auth owns its own schema and we do not put triggers in
 * it, so the signup flow is now explicit. Idempotent on owner_id, matching the
 * `on conflict do nothing` the trigger used.
 */
export async function ensureCompany(
  userId: string,
  email: string | null,
  name: string,
  description = "",
): Promise<string> {
  const [row] = await db()
    .insert(companies)
    .values({
      owner_id: userId,
      owner_email: email,
      name: name.trim() || "Untitled company",
      description,
    })
    .onConflictDoNothing({ target: companies.owner_id })
    .returning({ id: companies.id });
  if (row) return row.id;
  const [existing] = await db()
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.owner_id, userId))
    .limit(1);
  if (!existing) throw new Error("company insert failed");
  return existing.id;
}
