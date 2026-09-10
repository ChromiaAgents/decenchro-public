import "server-only";
import { createNeonAuth } from "@neondatabase/auth/next/server";

/**
 * Neon Auth (Managed Better Auth) — the control plane's identity provider,
 * replacing Supabase Auth. Google and email/password only: magic link is
 * disabled in the project config (user decision 2026-08-20). Users live in the `neon_auth` schema of the same Neon
 * database as the application tables, so they are joinable; what links them to a
 * company is companies.owner_email (see lib/dashboard/auth.ts).
 *
 * NEON_AUTH_BASE_URL is injected by the Vercel Neon store (it exists because the
 * store was created with `metadata.auth: true`, which cannot be turned on
 * afterwards). NEON_AUTH_COOKIE_SECRET is ours and must be set per environment —
 * the library rejects anything under 32 characters. It signs the session-data
 * cookie, so sessions survive a restart only while it stays put; rotating it
 * signs everyone out.
 */
const MIN_SECRET_LENGTH = 32;

export function authConfigured(): boolean {
  return Boolean(
    process.env.NEON_AUTH_BASE_URL &&
      (process.env.NEON_AUTH_COOKIE_SECRET?.length ?? 0) >= MIN_SECRET_LENGTH,
  );
}

let cached: ReturnType<typeof createNeonAuth> | null = null;

export function auth() {
  if (cached) return cached;
  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  const secret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!baseUrl || !secret) {
    throw new Error("Neon Auth env missing: set NEON_AUTH_BASE_URL and NEON_AUTH_COOKIE_SECRET");
  }
  cached = createNeonAuth({
    baseUrl,
    cookies: {
      secret,
      // Cache session data in a signed cookie for 5 minutes rather than calling
      // the auth server on every request. The console polls every 3-15s, so
      // without this each poll would pay a round trip to Neon.
      sessionDataTtl: 300,
      sameSite: "lax",
    },
  });
  return cached;
}
