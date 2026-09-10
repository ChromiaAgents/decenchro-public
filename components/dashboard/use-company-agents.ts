"use client";

import { useMemo } from "react";

import { POLL_IDLE_MS, useSharedPoll } from "@/components/dashboard/use-poll";
import type { ManagedAgent } from "@/lib/dashboard/deployments";
import type { FleetAgent } from "@/lib/dashboard/fleet";

export type CompanyAgent = {
  pubkey: string;
  fingerprint: string;
  // Deployed agents (from the registry) carry a name + lifecycle status;
  // on-chain-only members have neither.
  name: string | null;
  status: ManagedAgent["status"] | null;
  // On-chain stats, once the agent has signed at least one action.
  actions: number | null;
  lastActive: string | null;
  onChain: FleetAgent | null;
};

/**
 * The company's agents for the per-agent surfaces (Memory, Analytics): deployed
 * agents from the registry ∪ any on-chain fleet members, keyed by pubkey. Every
 * agent is remote. Deployed agents appear immediately — before they've signed
 * their first on-chain action — which the raw on-chain fleet would miss.
 *
 * `loading` is true only until the first fetch settles, so a roster list can
 * tell "still loading" apart from "you have no agents".
 */
export function useCompanyAgents(): {
  agents: CompanyAgent[];
  loading: boolean;
} {
  // Both endpoints go through the shared poller, so this hook costs nothing
  // extra when a surface that already reads them is mounted alongside it.
  const managedPoll = useSharedPoll<{ agents?: ManagedAgent[] }>(
    "/api/agents",
    POLL_IDLE_MS,
  );
  const fleetPoll = useSharedPoll<{ agents?: FleetAgent[]; error?: string }>(
    "/api/fleet",
    15_000,
  );

  const agents = useMemo(() => {
    const managed = managedPoll.data?.agents ?? [];
    const fleet = fleetPoll.data;
    const onchain = !fleet || fleet.error ? [] : (fleet.agents ?? []);
    const byPub = new Map<string, CompanyAgent>();
    for (const m of managed) {
      const oc =
        onchain.find(
          (a) => a.pubkey.toLowerCase() === m.pubkey.toLowerCase(),
        ) ?? null;
      byPub.set(m.pubkey.toLowerCase(), {
        pubkey: m.pubkey,
        fingerprint: m.fingerprint,
        name: m.agentName,
        status: m.status,
        actions: oc?.actions ?? null,
        lastActive: oc?.lastActive ?? null,
        onChain: oc,
      });
    }
    for (const a of onchain) {
      if (byPub.has(a.pubkey.toLowerCase())) continue;
      byPub.set(a.pubkey.toLowerCase(), {
        pubkey: a.pubkey,
        fingerprint: a.fingerprint,
        name: null,
        status: null,
        actions: a.actions,
        lastActive: a.lastActive,
        onChain: a,
      });
    }
    return [...byPub.values()];
  }, [managedPoll.data, fleetPoll.data]);

  return { agents, loading: managedPoll.loading || fleetPoll.loading };
}
