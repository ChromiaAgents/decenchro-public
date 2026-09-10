import "server-only";

import { createHmac } from "node:crypto";

import type { DeploymentRow } from "./deployments";
import { metricsBase } from "./deployments";

// Credentials for the Hermes dashboard a deployed agent exposes.
//
// Derived, never stored — the same pattern as metricsToken() and
// deployWebhookToken(): HMAC of the deployment id under ENCRYPTION_KEY. That
// matters more here than elsewhere, because these values are injected into the
// agent's environment, and a tenant can read their own agent's environment. A
// fleet-wide username/password would hand every tenant the key to every other
// agent's dashboard; a derived one is scoped to the single deployment that
// already knows it.
//
// Rotation is by rotating ENCRYPTION_KEY (which invalidates every derived
// secret at once) or by redeploying the agent under a new id.

// Fixed on purpose: the username is not a secret, and a per-deployment one just
// gives the operator a second string to copy.
export const DASHBOARD_USERNAME = "operator";

function derive(deploymentId: string, purpose: string, chars: number): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error("ENCRYPTION_KEY must be at least 32 characters");
  }
  return createHmac("sha256", key)
    .update(`decenchro-dashboard-${purpose}:${deploymentId}`)
    .digest("hex")
    .slice(0, chars);
}

// 32 hex chars = 128 bits. Typed by a human into a login form, so not longer.
export function dashboardPassword(deploymentId: string): string {
  return derive(deploymentId, "password", 32);
}

// Signs the dashboard's session cookies. The basic-auth plugin warns and falls
// back to an ephemeral value when this is unset, which logs every operator out
// on each container restart.
export function dashboardSessionSecret(deploymentId: string): string {
  return derive(deploymentId, "secret", 64);
}

/**
 * Public URL of a deployment's Hermes dashboard, or null when it does not have
 * one. Only Render agents expose it: a VM would need its own port opened, and on
 * a VM the tenant already has shell access, so the dashboard buys them nothing
 * they don't already have.
 */
export function dashboardUrl(row: DeploymentRow): string | null {
  if (row.provider !== "render") return null;
  return metricsBase(row);
}
