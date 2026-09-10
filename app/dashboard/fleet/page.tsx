import { getOwner, getSession } from "@/lib/dashboard/auth";
import { listAgentsWithSpend } from "@/lib/dashboard/deploy";
import { fetchFleet } from "@/lib/dashboard/fleet";

import { FleetSection } from "./fleet-section";

// Fleet, server-rendered. The roster used to arrive after two client fetches, so
// the section always painted "none deployed" first and corrected itself a moment
// later. Both payloads are fetched here and seeded into the same polls, so the
// first frame is the real fleet.
export const dynamic = "force-dynamic";

export default async function FleetPage() {
  const [owner, session] = await Promise.all([getOwner(), getSession()]);

  // Both in parallel, and both non-fatal: the on-chain roster reaches Chromia and
  // the registry reaches Supabase, so either can be slow or down. A failure here
  // must degrade to "client will fetch it" rather than 500 the whole section.
  const [managed, fleet] = await Promise.all([
    owner
      ? // Spend joined server-side too, or the first frame shows "—" under
        // Spent for every agent and corrects itself on the first client poll.
        listAgentsWithSpend(owner.companyId).then(
          (agents) => ({ agents }),
          () => null,
        )
      : Promise.resolve(null),
    fetchFleet().then(
      (f) => ({ agents: f.agents }),
      () => null,
    ),
  ]);

  // Same reveal wrapper as the other sections: Fleet used to animate itself with
  // framer-motion, so it entered on a different curve than every sibling route.
  return (
    <div className="animate-reveal">
      <FleetSection
        initialManaged={managed}
        initialFleet={fleet}
        canControl={session?.role === "admin"}
      />
    </div>
  );
}
