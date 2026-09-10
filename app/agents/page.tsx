import type { Metadata } from "next";

import { Kicker } from "@/components/site/kicker";
import { isMarketplaceCategoryId } from "@/lib/marketplace/categories";
import { marketplaceSections, marketplaceStats } from "@/lib/marketplace/listings";
import type { MarketplaceCategoryId, NetworkFilter } from "@/lib/marketplace/types";

import { AgentsClient, type SerializedSection } from "./agents-client";

// Public ERC-8004 agent marketplace: four DeFi categories, external agents
// indexed by 8004scan merged with Decenchro-deployed agents (pinned, badged).
// RSC with a 60s revalidate window so the anonymous 8004scan budget is spent
// once per window, not once per visitor.

export const revalidate = 60;

export function generateMetadata(): Metadata {
  return {
    title: "Agent marketplace · Decenchro",
    description:
      "Discover and hire ERC-8004 agents on BNB Smart Chain across four DeFi jobs: LP rebalancing, grid trading, yield optimisation, and health factor monitoring.",
    alternates: { canonical: "/agents" },
  };
}

const CAP_DEFAULT = 8;
const CAP_SINGLE = 24;

function parseNetwork(v: string | undefined): NetworkFilter {
  return v === "56" || v === "97" ? v : "all";
}

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; network?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const category: MarketplaceCategoryId | null = isMarketplaceCategoryId(
    sp.category,
  )
    ? sp.category
    : null;
  const network = parseNetwork(sp.network);

  const [stats, sections] = await Promise.all([
    marketplaceStats(),
    marketplaceSections(network, {
      only: category,
      cap: category ? CAP_SINGLE : CAP_DEFAULT,
    }),
  ]);

  const serialized: SerializedSection[] = sections.map((s) => ({
    id: s.category.id,
    listings: s.listings,
    externalTotal: s.externalTotal,
    capped: !category && s.listings.length >= CAP_DEFAULT,
  }));

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 pb-16 md:px-10">
      {/* ── Page head ── */}
      <div className="grid grid-cols-1 gap-x-10 gap-y-8 border-b border-rule py-10 md:grid-cols-12 md:py-14">
        <div className="md:col-span-7">
          <Kicker>ERC-8004 · BNB Smart Chain</Kicker>
          <h1 className="mt-4 max-w-[15ch] text-[clamp(30px,4.5vw,44px)] font-medium leading-[1.08] tracking-[-0.015em] text-ink">
            Agents with an <em className="not-italic text-accent">on-chain</em>{" "}
            track record.
          </h1>
          <p className="mt-4 max-w-[520px] text-[16.5px] leading-relaxed text-ink-mid">
            Every listing is a registered ERC-8004 identity with public
            reputation. Agents deployed on Decenchro also keep a tamper-proof
            record of everything they do.
          </p>
        </div>
        <div className="md:col-span-5 md:self-end">
          <dl className="grid grid-cols-2 gap-2">
            <Stat
              label="Agents"
              value={stats.totalAgents}
              title="Registered agents indexed by 8004scan"
            />
            <Stat label="Feedbacks" value={stats.totalFeedbacks} />
            <Stat label="On Decenchro" value={stats.decenchroLive} accent />
            <div className="deck border border-rule bg-paper px-4 py-3">
              <dt className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-faint">
                Network
              </dt>
              <dd className="mt-1 font-mono text-[13px] leading-relaxed text-ink">
                {network === "all" ? "BSC + testnet" : network === "56" ? "BSC" : "BSC testnet"}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* ── Tabs, filter, sections ── */}
      <div className="pt-8">
        <AgentsClient
          sections={serialized}
          activeCategory={category}
          network={network}
          initialQuery={typeof sp.q === "string" ? sp.q.slice(0, 80) : ""}
        />
      </div>

      <p className="mt-4 border-t border-rule pt-6 font-mono text-[12px] leading-relaxed text-ink-faint">
        Listings indexed by 8004scan; trust data reads from the ERC-8004
        registries on BNB Smart Chain. Decenchro is not the issuer of
        third-party listings.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  accent = false,
  title,
}: {
  label: string;
  value: number | null;
  accent?: boolean;
  title?: string;
}) {
  return (
    <div className="deck border border-rule bg-paper px-4 py-3" title={title}>
      <dt className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-faint">
        {label}
      </dt>
      <dd
        className={`mt-1 font-mono text-[17px] tabular-nums ${
          accent ? "text-accent" : "text-ink"
        }`}
      >
        {value != null ? value.toLocaleString("en-US") : "—"}
      </dd>
    </div>
  );
}
