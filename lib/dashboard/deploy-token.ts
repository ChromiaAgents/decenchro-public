import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Per-deployment callback token for /api/deploy/webhook.
//
// The token that ships in a VPS's cloud-init is readable by whoever controls
// that box (metadata service, the agent's own shell), so it must not be the
// same value for every tenant — otherwise one customer can read it off their
// droplet and drive any other customer's deployment status. Derive it the same
// way metricsToken() does: an HMAC of the deployment id under a server-held
// secret. Nothing extra is stored; the route recomputes it from the id in the
// request and a token only ever authorises the one deployment it names.
export function deployWebhookToken(deploymentId: string): string {
  const secret = process.env.DEPLOY_WEBHOOK_SECRET;
  if (!secret) throw new Error("DEPLOY_WEBHOOK_SECRET is not set");
  return createHmac("sha256", secret)
    .update(`decenchro-deploy:${deploymentId}`)
    .digest("hex");
}

export function deployWebhookTokenValid(
  deploymentId: string,
  token: string | null,
): boolean {
  if (!token) return false;
  let expected: string;
  try {
    expected = deployWebhookToken(deploymentId);
  } catch {
    return false;
  }
  const got = Buffer.from(token);
  const want = Buffer.from(expected);
  return got.length === want.length && timingSafeEqual(got, want);
}
