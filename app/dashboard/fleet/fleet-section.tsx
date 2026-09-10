"use client";

import { useRouter } from "next/navigation";

import { FleetTabView } from "../dashboard-client";
import type { FleetAgent } from "@/lib/dashboard/fleet";
import type { ManagedAgent } from "@/lib/dashboard/deployments";

// Thin client boundary: the page is a server component, but the roster needs a
// router for the drill-into-agent link, so the handler lives here rather than
// pushing "use client" up into the data fetching.
export function FleetSection({
  initialManaged,
  initialFleet,
  canControl,
}: {
  initialManaged: { agents?: ManagedAgent[] } | null;
  initialFleet: { agents?: FleetAgent[]; error?: string } | null;
  canControl?: boolean;
}) {
  const router = useRouter();
  return (
    <FleetTabView
      canControl={canControl ?? true}
      initialManaged={initialManaged}
      initialFleet={initialFleet}
      onInspectAgent={(a) =>
        router.push(
          `/dashboard/atbash?agent=${encodeURIComponent(a.pubkey)}&fp=${encodeURIComponent(a.fingerprint)}`,
        )
      }
    />
  );
}
