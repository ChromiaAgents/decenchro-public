import "server-only";
import { count, notInArray } from "drizzle-orm";

import { db, dbConfigured } from "@/lib/db/client";
import { companies, deployments } from "@/db/schema";

// Public counters for the landing page. All-time, every deployment ever made
// including our own testing (user decision 2026-08-07).

export type PublicStats = {
  // Agents that actually came up. Excludes failed deploys, and excludes any
  // still provisioning — those haven't come up yet.
  agentsDeployed: number;
  companiesOnboarded: number;
};

/**
 * Returns null when the data can't be read, so the caller omits the pills
 * rather than rendering zeros that aren't true.
 */
export async function getPublicStats(): Promise<PublicStats | null> {
  if (!dbConfigured()) return null;
  try {
    // Counted in SQL. The PostgREST version selected every deployment row and
    // filtered in JS, which read the whole table to produce one integer.
    const [agents, orgs] = await Promise.all([
      db()
        .select({ n: count() })
        .from(deployments)
        .where(notInArray(deployments.status, ["pending", "provisioning", "failed"])),
      db().select({ n: count() }).from(companies),
    ]);
    return {
      agentsDeployed: agents[0]?.n ?? 0,
      companiesOnboarded: orgs[0]?.n ?? 0,
    };
  } catch {
    return null;
  }
}
