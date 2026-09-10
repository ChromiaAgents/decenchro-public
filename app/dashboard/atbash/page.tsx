import { getOwner } from "@/lib/dashboard/auth";
import { fingerprintOf, listDeploymentRows } from "@/lib/dashboard/deployments";

import { AtbashSection } from "./atbash-section";

// Atbash governance. The drilled-into agent is a URL param rather than component
// state, so /dashboard/atbash?agent=…&fp=… is linkable and survives a refresh.
//
// Because it is a URL param it is also attacker-supplied, so it is checked here
// against the caller's own deployments instead of being passed through. An
// unrecognised pubkey drops the scope rather than erroring: the fallback is the
// caller's whole (already-scoped) fleet, which leaks nothing. The fingerprint is
// derived from the verified pubkey rather than read from the URL, so the label
// cannot be spoofed either.
export const dynamic = "force-dynamic";

export default async function AtbashPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string }>;
}) {
  const [{ agent }, owner] = await Promise.all([searchParams, getOwner()]);

  let scoped: string | undefined;
  if (agent && owner) {
    const rows = await listDeploymentRows(owner.companyId);
    const match = rows.find(
      (r) => (r.atbash_pubkey ?? "").toLowerCase() === agent.toLowerCase(),
    );
    scoped = match?.atbash_pubkey ?? undefined;
  }

  return (
    <AtbashSection
      scopedAgentPubkey={scoped}
      scopedFingerprint={scoped ? fingerprintOf(scoped) : undefined}
    />
  );
}
