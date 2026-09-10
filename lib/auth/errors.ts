/**
 * Turns raw Neon Auth / Better Auth errors into plain, actionable copy.
 *
 * The provider returns SCREAMING_SNAKE codes (INVALID_EMAIL_OR_PASSWORD,
 * USER_ALREADY_EXISTS) alongside a terse message. Showing either verbatim reads
 * like a system log, not guidance — so match the code first, the message text
 * second, and fall back to a calm generic line.
 *
 * Replaces lib/supabase/auth-errors.ts, which matched GoTrue's lowercase prose
 * ("invalid login credentials") and its `#error_code=otp_expired` URL fragments.
 * Both of those vocabularies are gone; the text matching below is kept as a
 * second pass because this provider is beta and undocumented codes do appear.
 */
export function friendlyAuthError(
  code: string | undefined,
  raw: string | undefined,
  mode: "login" | "signup",
): string {
  const c = (code ?? "").toUpperCase();
  const m = (raw ?? "").toLowerCase();

  if (c === "INVALID_EMAIL_OR_PASSWORD" || m.includes("invalid email or password"))
    return "That email and password don't match. Check them and try again.";

  if (c === "EMAIL_NOT_VERIFIED" || m.includes("not verified"))
    return "Confirm your email first. Check your inbox for the link.";

  if (c === "USER_ALREADY_EXISTS" || m.includes("already exists") || m.includes("already registered"))
    return "An account with this email already exists. Sign in instead.";

  if (c === "TOO_MANY_REQUESTS" || m.includes("rate limit") || m.includes("too many"))
    return mode === "signup"
      ? "Too many sign-ups right now. Wait a minute and try again."
      : "Too many attempts. Wait a minute and try again.";

  // A per-address cooldown, if this provider words it the way GoTrue did.
  const secs = /after (\d+) seconds?/.exec(m)?.[1];
  if (secs) return `Already sent. You can request another in ${secs} seconds.`;

  if (c === "PASSWORD_TOO_SHORT" || (m.includes("password") && (m.includes("least") || m.includes("short"))))
    return "Use a password with at least 8 characters.";

  if (m.includes("weak") && m.includes("password"))
    return "That password is too weak. Try a longer, less common one.";

  if (c === "INVALID_EMAIL" || (m.includes("invalid") && m.includes("email")))
    return "That email address doesn't look right.";

  if (c === "SIGNUP_DISABLED" || m.includes("signup") && m.includes("disabled"))
    return "New sign-ups are currently closed.";

  if (c === "NETWORK" || m.includes("failed to fetch") || m.includes("network") || m.includes("load failed"))
    return "Couldn't reach the server. Check your connection and retry.";

  // Unknown. Keep it human, not a raw dump.
  return mode === "signup"
    ? "Couldn't create your account. Please try again."
    : "Couldn't sign you in. Please try again.";
}

/**
 * Copy for an OAuth round trip that didn't produce a session.
 *
 * /auth/callback can only tell that no session came out of the exchange, so it
 * forwards a coarse `reason`. Every branch is recoverable by requesting a fresh
 * link, which is the whole point: an expired link must not dead-end on a blank
 * sign-in form.
 */
export function friendlyLinkError(
  code: string | null | undefined,
  reason: string | null | undefined,
): string {
  const c = (code ?? "").toUpperCase();

  if (c === "INVALID_TOKEN" || c === "TOKEN_EXPIRED" || reason === "expired")
    return "That sign-in link has expired. Start again below.";

  if (c === "VERIFICATION_NOT_FOUND" || reason === "used")
    return "That sign-in link has already been used. Start again below.";

  if (reason === "exchange")
    return "Google sign-in didn't complete. Try again, or sign in with your password.";

  return "That sign-in didn't work. Try again, or sign in with your password.";
}
