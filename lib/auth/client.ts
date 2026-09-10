"use client";

/**
 * Browser-side Neon Auth calls, as plain fetches against our own
 * /api/auth/[...path] route rather than through @neondatabase/auth's
 * createAuthClient.
 *
 * Two reasons. The session cookie stays first-party by construction — Neon sets
 * its cookie on *.neon.tech, so anything talking to the auth server directly
 * depends on third-party cookies, which Safari blocks. And the client factory
 * takes a base URL whose interaction with Better Auth's basePath is not
 * documented; the endpoint paths are, so this hits them directly. Same approach
 * as chromia-pay's apps/dashboard/lib/neon-auth.ts.
 *
 * A failed call comes back as a non-2xx with a JSON body carrying `code` and
 * `message` — both are returned so the caller can map a code to friendly copy
 * (lib/auth/errors.ts) and fall back to the server's message when it cannot.
 */
export type AuthResult<T = unknown> = { ok: true; data: T } | { ok: false; code: string; message: string };

async function post<T>(path: string, body?: Record<string, unknown>): Promise<AuthResult<T>> {
  let res: Response;
  try {
    res = await fetch(`/api/auth/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    return { ok: false, code: "NETWORK", message: "Network error. Check your connection." };
  }
  // Read as text first: an auth proxy can answer with an empty body, and
  // res.json() on "" throws a SyntaxError that reads like a real auth failure.
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const body = (parsed ?? {}) as { code?: string; message?: string; error?: string };
    return {
      ok: false,
      code: body.code ?? `HTTP_${res.status}`,
      message: body.message ?? body.error ?? "Something went wrong. Please try again.",
    };
  }
  return { ok: true, data: (parsed ?? {}) as T };
}

const origin = () => (typeof window === "undefined" ? "" : window.location.origin);

export function signInWithPassword(email: string, password: string) {
  return post("sign-in/email", { email, password });
}

export function signUpWithPassword(
  email: string,
  password: string,
  name: string,
) {
  return post("sign-up/email", { email, password, name });
}

/** Google OAuth. The response carries the URL to send the browser to. */
export function signInWithGoogle(next: string) {
  return post<{ url?: string; redirect?: boolean }>("sign-in/social", {
    provider: "google",
    callbackURL: `${origin()}/auth/callback?next=${encodeURIComponent(next)}`,
  });
}

export function requestPasswordReset(email: string) {
  return post("request-password-reset", {
    email,
    redirectTo: `${origin()}/reset-password`,
  });
}

export function resetPassword(newPassword: string, token: string) {
  return post("reset-password", { newPassword, token });
}

export function signOut() {
  return post("sign-out");
}
