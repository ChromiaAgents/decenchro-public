import { NextResponse, type NextRequest } from "next/server";

import { auth, authConfigured } from "@/lib/auth/server";

// Next.js 16 renamed the "middleware" convention to "proxy" (same behaviour).
//
// Scoped, not site-wide. Neon Auth's middleware protects EVERYTHING except an
// allowlist of skip routes, which is backwards for a site whose home, /agents
// marketplace and login pages are all public — so rather than enumerate every
// public route, the matcher hands it only the routes that need it. The marketing
// pages then pay nothing for auth at all.
//
// Two routes need it, for different reasons:
//
//   /dashboard      — the session guard.
//   /auth/callback  — the OAuth exchange, which is middleware's job and nowhere
//                     else's. The SDK's exchangeOAuthToken() runs from
//                     processAuthMiddleware and fires only when it sees BOTH the
//                     neon_auth_session_verifier parameter AND a session
//                     challenge cookie; it then mints first-party cookies,
//                     strips the verifier and redirects. With the matcher on
//                     /dashboard alone the middleware never saw the callback, so
//                     Google returned a verifier that nothing ever redeemed and
//                     sign-in failed with NO_SESSION. /auth/callback is in
//                     DEFAULT_AUTH_SKIP_ROUTES, so adding it buys the exchange
//                     without the middleware trying to protect it.
//
// The old Supabase proxy also bounced signed-in users away from /login and
// /signup. That moved into those two pages, which can check server-side.
export async function proxy(request: NextRequest) {
  // Local admin bypass (dev only) — hard-guarded against production and Vercel
  // so a stray env var in a real deploy is inert. Mirrors lib/dashboard/auth.ts.
  if (
    process.env.DEV_AUTH_BYPASS === "1" &&
    process.env.NODE_ENV !== "production" &&
    process.env.VERCEL !== "1"
  ) {
    return NextResponse.next({ request });
  }

  // No auth configured (local dev without env) — pass through untouched, which
  // is what keeps the console reachable offline.
  if (!authConfigured()) return NextResponse.next({ request });

  return auth().middleware({ loginUrl: "/login" })(request);
}

export const config = {
  matcher: ["/dashboard", "/dashboard/:path*", "/auth/callback"],
};
