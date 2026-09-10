/**
 * A `?next=` value that is safe to redirect to.
 *
 * Client-safe on purpose: the auth form and both auth pages share it, and the
 * pages are server components. Only same-origin absolute paths pass —
 * `//evil.com` is a protocol-relative URL that `startsWith("/")` accepts on its
 * own, so it has to be rejected explicitly or `?next=` becomes an open redirect.
 */
export function safeNextPath(
  value: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (!value) return fallback;
  return value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}
