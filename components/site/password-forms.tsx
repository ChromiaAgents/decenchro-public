"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { requestPasswordReset, resetPassword } from "@/lib/auth/client";
import { friendlyAuthError } from "@/lib/auth/errors";
import { inputCls, labelCls, submitCls, useHydrated } from "./auth-form";

// The two halves of password recovery. Request a link here, then Supabase
// mails a one-time link back to /auth/callback, which exchanges it for a
// session and lands on /reset-password to set the new password.

const shellCls = "dh-band-dark dh-auth";
const cardCls = "dh-auth-card";
const titleCls =
  "dh-auth-title";
const leadCls = "dh-auth-lead";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const hydrated = useHydrated();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await requestPasswordReset(email);
      // Anything but a transport/rate-limit problem still shows the neutral
      // confirmation below: whether an account exists is not ours to disclose.
      if (!res.ok && /NETWORK|TOO_MANY/i.test(res.code)) {
        setError(friendlyAuthError(res.code, res.message, "login"));
        return;
      }
      setSent(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={shellCls}>
      <form onSubmit={submit} className={cardCls}>
        <h1 className={titleCls}>Reset password</h1>
        <p className={leadCls}>
          {sent
            ? "Check your inbox and open the link to choose a new password."
            : "Enter your email and we will send you a link to set a new password."}
        </p>

        {sent ? (
          <p role="status" aria-live="polite" className="dh-auth-ok">
            If an account exists for {email}, a reset link is on its way. The
            link expires after an hour.
          </p>
        ) : (
          <>
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

            {error && (
              <p role="alert" className="mt-3 dh-auth-err">
                {error}
              </p>
            )}

            <button type="submit" disabled={busy || !hydrated} className={submitCls}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </>
        )}

        <p className="dh-auth-foot">
          <Link href="/login" className="dh-auth-link">
            Back to sign in
          </Link>
        </p>
      </form>
    </main>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hydrated = useHydrated();
  // Better Auth puts a single-use token in the reset link and takes it back on
  // submit; there is no session to check, unlike the Supabase flow this replaces
  // (which signed the user in first and then called updateUser). No token in the
  // URL means the link is unusable, and that is knowable immediately.
  const params = useSearchParams();
  const token = params.get("token");
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!token) setExpired(true);
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!token) {
        setExpired(true);
        return;
      }
      // Never let the button sit on "Saving…" forever: if the auth call stalls,
      // surface it so the operator can retry instead of staring at a spinner.
      const res = await Promise.race([
        resetPassword(password, token),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timed out")), 15_000),
        ),
      ]);
      if (!res.ok) {
        // A spent or expired token: say so instead of a generic failure.
        if (/INVALID_TOKEN|TOKEN_EXPIRED|VERIFICATION_NOT_FOUND/i.test(res.code)) {
          setExpired(true);
          return;
        }
        setError(friendlyAuthError(res.code, res.message, "signup"));
        return;
      }
      router.push("/login?next=/dashboard");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : undefined;
      setError(
        msg === "timed out"
          ? "That took too long. Reload the page and try again."
          : friendlyAuthError(undefined, msg, "signup"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={shellCls}>
      <form onSubmit={submit} className={cardCls}>
        <h1 className={titleCls}>Choose a new password</h1>
        <p className={leadCls}>
          {expired
            ? "That link has expired or was already used."
            : "Pick something you have not used here before."}
        </p>

        {expired ? (
          <Link href="/forgot-password" className={`${submitCls} mt-0 block text-center`}>
            Request a new link
          </Link>
        ) : (
          <>
            <label className="block">
              <span className={labelCls}>new password</span>
              <div className="relative mt-1">
                <input
                  type={showPw ? "text" : "password"}
                  required
                  minLength={8}
                  autoFocus
                  autoComplete="new-password"
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
              <span className="dh-auth-hint">
                At least 8 characters.
              </span>
            </label>

            <label className="mt-3 block">
              <span className={labelCls}>confirm password</span>
              <input
                type={showPw ? "text" : "password"}
                required
                minLength={8}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={inputCls}
              />
            </label>

            {error && (
              <p role="alert" className="mt-3 dh-auth-err">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !hydrated}
              className={submitCls}
            >
              {busy ? "Saving…" : "Save password"}
            </button>
          </>
        )}
      </form>
    </main>
  );
}
