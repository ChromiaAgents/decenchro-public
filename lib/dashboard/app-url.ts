import "server-only";

/**
 * Public base URL of this app. Explicit override wins; else the Vercel
 * deployment URL. Shared by the deploy orchestrator (webhook URL) and the
 * ERC-8004 module (agent card / attestation URIs) — lives in its own module so
 * deploy.ts and bsc.ts don't import each other.
 */
export function appBaseUrl(): string {
  const explicit = process.env.APP_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}
