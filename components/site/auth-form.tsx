"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import {
  signInWithGoogle,
  signInWithPassword,
  signUpWithPassword,
} from "@/lib/auth/client";
import { friendlyAuthError, friendlyLinkError } from "@/lib/auth/errors";
import { safeNextPath } from "@/lib/next-path";

type Mode = "login" | "signup";

/** Ways out of a failed auth attempt, rendered as inline links under the error. */
type AuthAction = "signin" | "reset";

// Shared with the password-reset forms so the auth screens can't drift apart.
export const labelCls =
  "dh-auth-label";
export const inputCls =
  "dh-auth-input";
export const submitCls =
  "dh-btn dh-auth-submit";

/**
 * True once React has hydrated this tree.
 *
 * Until then a form's onSubmit handler is not attached, so a click on the submit
 * button is a *native* submission: a GET back to the same URL. The inputs carry
 * no `name`, so nothing is even sent — the page reloads with every field
 * cleared, which reads as "it did nothing" and sends people round to try again.
 * The (site) bundle is big enough that a fast typist beats hydration on a cold
 * cache, and signup was losing people to exactly that.
 *
 * Gating the submit button on this is the cheapest correct guard. Not a server
 * action (which Next would queue and replay pre-hydration) because these forms
 * post to /api/auth from the browser by design — see lib/auth/client.ts.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const params = useSearchParams();
  // Only honor same-origin relative paths to avoid open redirects. Shared with
  // the two auth pages, which forward ?next on their signed-in redirect.
  const next = safeNextPath(params.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState("");
  const [companyDesc, setCompanyDesc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Recovery routes offered alongside an error, so no failure is a dead end.
  const [actions, setActions] = useState<AuthAction[]>([]);
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const isSignup = mode === "signup";

  const clearFeedback = () => {
    setError(null);
    setNotice(null);
    setActions([]);
  };

  const fail = (message: string, offer: AuthAction[] = []) => {
    setError(message);
    setActions(offer);
  };

  // A sign-in link that failed lands here via /auth/callback. Neon Auth reports
  // the cause in the query string (GoTrue used the URL fragment, which never
  // reached the server), so read it on mount and strip it so a refresh doesn't
  // replay a stale error.
  useEffect(() => {
    const reason = params.get("error");
    const code = params.get("error_code");
    if (!reason && !code) return;

    fail(friendlyLinkError(code, reason), ["reset"]);

    const url = new URL(window.location.href);
    url.searchParams.delete("error");
    url.searchParams.delete("error_code");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [params]);

  /** Google OAuth. The provider answers with the URL to hand the browser. */
  const google = async () => {
    setBusy(true);
    clearFeedback();
    try {
      const res = await signInWithGoogle(next);
      if (!res.ok) {
        fail(friendlyAuthError(res.code, res.message, mode));
        return;
      }
      const url = (res.data as { url?: string }).url;
      if (!url) {
        setError("Couldn't start Google sign-in. Please try again.");
        return;
      }
      window.location.href = url;
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    clearFeedback();
    try {
      if (isSignup) {
        const res = await signUpWithPassword(email, password, company.trim());
        if (!res.ok) {
          fail(
            friendlyAuthError(res.code, res.message, "signup"),
            res.code === "USER_ALREADY_EXISTS" ? ["signin", "reset"] : [],
          );
          return;
        }
        // The company row is ours to create now. Under Supabase a SECURITY
        // DEFINER trigger on auth.users did it from raw_user_meta_data; Neon
        // Auth owns its schema, so the app inserts it explicitly once the
        // session cookie from sign-up exists. Idempotent server-side, so the
        // retry below is safe.
        const created = await fetch("/api/company", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: company.trim(), description: companyDesc.trim() }),
        });
        if (!created.ok && created.status !== 401) {
          // Account exists but the profile does not. Say so rather than dropping
          // them into a console that will report no company.
          setError("Account created, but saving your company failed. Reload to retry.");
          return;
        }
        router.push(next);
        router.refresh();
      } else {
        const res = await signInWithPassword(email, password);
        if (!res.ok) {
          // Two recoverable cases get an explicit way out instead of a dead end:
          // an unverified address, and one of the migrated accounts whose old
          // Supabase password no longer exists to match.
          const unverified = res.code === "EMAIL_NOT_VERIFIED";
          const noMatch = res.code === "INVALID_EMAIL_OR_PASSWORD";
          fail(
            friendlyAuthError(res.code, res.message, "login"),
            unverified || noMatch ? ["reset"] : [],
          );
          return;
        }
        router.push(next);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="dh-band-dark dh-auth">
      <form
        onSubmit={submit}
        className="dh-auth-card"
      >
        <h1 className="dh-auth-title">
          {isSignup ? "Create account" : "Sign in"}
        </h1>
        <p className="dh-auth-lead">
          {isSignup
            ? "Register your company to deploy and audit agents on Chromia."
            : "Sign in to your decenchro workspace."}
        </p>

        <button
          type="button"
          onClick={google}
          disabled={busy || !hydrated}
          className="dh-auth-oauth"
        >
          Continue with Google
        </button>
        <p className="dh-auth-divider">
          <span>or</span>
        </p>

        <label className="block">
          <span className={labelCls}>email</span>
          <input
            type="email"
            required
            autoFocus
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
          />
        </label>

        <label className="mt-3 block">
          <span className="flex items-baseline justify-between gap-3">
            <span className={labelCls}>password</span>
            {!isSignup && (
              <Link
                href="/forgot-password"
                className="font-mono text-[11px] uppercase tracking-[0.08em] dh-auth-link"
              >
                Forgot?
              </Link>
            )}
          </span>
          <div className="relative mt-1">
            <input
              type={showPw ? "text" : "password"}
              required
              minLength={8}
              autoComplete={isSignup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${inputCls} mt-0 pr-12`}
            />
            <button
              type="button"
              onClick={() => setShowPw((s) => !s)}
              aria-label={showPw ? "Hide password" : "Show password"}
              className="dh-auth-reveal"
            >
              {showPw ? "hide" : "show"}
            </button>
          </div>
          {isSignup && (
            <span className="dh-auth-hint">
              At least 8 characters.
            </span>
          )}
        </label>

        {isSignup && (
          <>
            <label className="mt-3 block">
              <span className={labelCls}>company name</span>
              <input
                type="text"
                required
                maxLength={120}
                autoComplete="organization"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="mt-3 block">
              <span className={labelCls}>company description</span>
              <textarea
                rows={3}
                maxLength={2000}
                value={companyDesc}
                onChange={(e) => setCompanyDesc(e.target.value)}
                placeholder="What does your company do?"
                className={`${inputCls} resize-none`}
              />
            </label>
          </>
        )}

        {error && (
          <div role="alert" className="mt-3 dh-auth-err">
            <p>{error}</p>
            {actions.length > 0 && (
              <p className="dh-auth-actions">
                {actions.map((action, i) => (
                  <span key={action} className="contents">
                    {i > 0 && <span aria-hidden="true">·</span>}
                    {action === "signin" && (
                      <Link
                        href={`/login?next=${encodeURIComponent(next)}`}
                        className="dh-auth-link"
                      >
                        Sign in
                      </Link>
                    )}
                    {action === "reset" && (
                      <Link href="/forgot-password" className="dh-auth-link">
                        Reset your password
                      </Link>
                    )}
                  </span>
                ))}
              </p>
            )}
          </div>
        )}
        {notice && (
          <p
            role="status"
            aria-live="polite"
            className="mt-3 dh-auth-ok"
          >
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !hydrated}
          className={submitCls}
        >
          {busy
            ? isSignup
              ? "Creating account…"
              : "Signing in…"
            : isSignup
              ? "Create account"
              : "Sign in"}
        </button>

        <p className="dh-auth-foot">
          {isSignup ? (
            <>
              Already have an account?{" "}
              <Link href="/login" className="dh-auth-link">
                Sign in
              </Link>
            </>
          ) : (
            <>
              No account?{" "}
              <Link href="/signup" className="dh-auth-link">
                Register your company
              </Link>
            </>
          )}
        </p>
      </form>
    </main>
  );
}
