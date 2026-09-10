import { auth } from "@/lib/auth/server";

/**
 * Every Neon Auth endpoint: sign-in/email, sign-in/social, sign-up/email,
 * sign-out, request-password-reset, reset-password, get-session.
 *
 * sign-in/magic-link is reachable but unused: magic link is disabled in the
 * Neon Auth project config, so the server rejects it.
 *
 * The client posts here rather than straight at the Neon Auth server, which is
 * what keeps the session cookie first-party: Neon sets its cookie on
 * *.neon.tech, and the browser would never send that back to decenchro.com.
 *
 * The handler is built per request, not at module scope. auth() throws when
 * NEON_AUTH_BASE_URL / NEON_AUTH_COOKIE_SECRET are unset, and `next build`
 * imports every route while collecting page data — so constructing it eagerly
 * fails the build on any machine without the auth env, local ones included.
 */
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

const call = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE") =>
  async function handler(request: Request, ctx: Ctx) {
    return auth().handler()[method](request, ctx);
  };

export const GET = call("GET");
export const POST = call("POST");
export const PUT = call("PUT");
export const PATCH = call("PATCH");
export const DELETE = call("DELETE");
