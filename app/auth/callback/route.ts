import { NextResponse, type NextRequest } from "next/server";

/**
 * Where Google sign-in lands (and any other OAuth provider added later).
 *
 * The exchange itself happens in proxy.ts, not here. The SDK's
 * exchangeOAuthToken() runs from its middleware and is the only thing that
 * performs the session-challenge check, mints first-party cookies and strips the
 * verifier — so /auth/callback is in the proxy matcher, and by the time this
 * handler runs the session normally already exists. What is left for it is
 * deciding where to send the visitor, and reporting a readable failure when the
 * exchange did not happen.
 *
 * The forwarding below stays as a fallback for the case where middleware
 * declined (no challenge cookie, e.g. a link opened in a different browser).
 *
 * The trap this exists to handle: Neon Auth completes the sign-in on **its own**
 * host, so the session cookie it sets belongs to *.neon.tech and the browser
 * will never send it back to decenchro.com. Instead Neon appends a single-use
 * `neon_auth_session_verifier` to the callback URL, and that has to be redeemed
 * through our own /api/auth proxy, which mints a first-party cookie.
 *
 * This was briefly a client page that redeemed the verifier with fetch(). Do not
 * go back to that. The page was statically prerendered, so its Suspense fallback
 * shipped as HTML, and any failure to hydrate — or an effect that never ran —
 * left the visitor on "Signing you in…" forever with no redirect and nothing in
 * the logs. A route handler cannot get stuck: it either redirects or it errors
 * where the error is visible.
 *
 * The exchange goes through our own /api/auth/get-session rather than straight
 * at NEON_AUTH_BASE_URL, because that proxy is what rewrites the upstream
 * cookies for this domain. Whatever Set-Cookie headers it returns are copied
 * onto the redirect, which is how the session survives the hop.
 *
 * Two provider behaviours to keep in mind: the verifier is single-use, so a
 * refresh legitimately reports VERIFICATION_NOT_FOUND, and a refusal can arrive
 * as HTTP 200 with an `error` body — the status alone proves nothing, the body
 * has to be read.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const nextParam = url.searchParams.get("next") ?? "/dashboard";
  // Only same-origin relative paths, to avoid an open redirect.
  const next =
    nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard";

  const bail = (reason: string, code?: string | null) =>
    NextResponse.redirect(
      new URL(
        `/login?error=${reason}` +
          (code ? `&error_code=${encodeURIComponent(code)}` : "") +
          `&next=${encodeURIComponent(next)}`,
        url.origin,
      ),
    );

  // The provider rejected the link before it ever reached us.
  const providerError = url.searchParams.get("error");
  if (providerError) {
    console.log(`[AUDIT] auth callback rejected upstream: ${providerError}`);
    return bail("link", providerError);
  }

  const verifier = url.searchParams.get("neon_auth_session_verifier");
  // Shape-check before forwarding, so a junk query string never reaches the auth
  // server: Neon issues `<prefix>-<hex>`.
  if (verifier && !/^[a-z]{2,8}-[0-9a-f]{16,64}$/.test(verifier)) {
    return bail("exchange", "MALFORMED_VERIFIER");
  }

  /**
   * Forward every parameter the exchange might need, not just the verifier.
   *
   * Magic link came back as `neon_auth_session_verifier`, so the first version
   * looked for exactly that and dropped everything else — which made Google fail
   * with NO_SESSION: the provider returned on a different parameter, nothing was
   * forwarded, and get-session was asked "is there a session?" with no material
   * to make one from. It answered honestly.
   *
   * An allowlist rather than the whole query string: this hands values to the
   * auth server, so `next` and anything else a caller appends stays out of it.
   */
  const FORWARDED = [
    "neon_auth_session_verifier",
    "code",
    "state",
    "token",
    "neon_popup",
    "neon_popup_callback",
  ] as const;

  const exchange = new URL("/api/auth/get-session", url.origin);
  const seen: string[] = [];
  for (const key of FORWARDED) {
    const value = url.searchParams.get(key);
    if (value) {
      exchange.searchParams.set(key, value);
      seen.push(key);
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(exchange, {
      headers: {
        // Carry any cookie the browser already has: an OAuth round trip may
        // have left a session challenge cookie that the exchange needs.
        cookie: request.headers.get("cookie") ?? "",
      },
      cache: "no-store",
    });
  } catch (err) {
    console.error("[auth] callback exchange failed", err);
    return bail("exchange", "NETWORK");
  }

  const text = await upstream.text();
  let body: { user?: unknown; code?: string; error?: string } | null = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!body?.user) {
    const code = body?.code ?? (upstream.ok ? "NO_SESSION" : `HTTP_${upstream.status}`);
    // Log which parameters actually arrived. NO_SESSION with nothing forwarded
    // means the provider used a parameter this route does not know about, which
    // is a different fault from a spent or rejected credential.
    console.log(
      `[AUDIT] auth callback produced no session: ${code} forwarded=[${seen.join(",")}] ` +
        `received=[${[...url.searchParams.keys()].join(",")}]`,
    );
    return bail("exchange", code);
  }

  // Hand the minted cookies to the browser along with the redirect. Without
  // this the exchange succeeds and the session is immediately lost.
  const response = NextResponse.redirect(new URL(next, url.origin));
  for (const cookie of upstream.headers.getSetCookie()) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}
