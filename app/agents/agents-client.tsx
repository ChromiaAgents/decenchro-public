"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { Button } from "@/components/site/button";
import {
  hireHref,
  MARKETPLACE_CATEGORIES,
  type MarketplaceCategory,
} from "@/lib/marketplace/categories";
import {
  chainLabel,
  type MarketplaceCategoryId,
  type MarketplaceListing,
  type NetworkFilter,
} from "@/lib/marketplace/types";

import { AgentImage } from "./agent-image";

// Client island for /agents: category tabs + network toggle synced to the URL
// (router.replace, so the RSC refetches the right sections), and an instant
// text filter over the server-passed listings. Everything below the page head
// renders here so the filter can hide cards without a server round trip.

export type SerializedSection = {
  id: MarketplaceCategoryId;
  listings: MarketplaceListing[];
  externalTotal: number | null;
  capped: boolean;
};

function urlFor(category: MarketplaceCategoryId | null, network: NetworkFilter) {
  const q = new URLSearchParams();
  if (category) q.set("category", category);
  if (network !== "all") q.set("network", network);
  const s = q.toString();
  return s ? `/agents?${s}` : "/agents";
}

export function AgentsClient({
  sections,
  activeCategory,
  network,
  initialQuery = "",
}: {
  sections: SerializedSection[];
  activeCategory: MarketplaceCategoryId | null;
  network: NetworkFilter;
  initialQuery?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [active, setActive] = useState<MarketplaceCategoryId | null>(activeCategory);
  // Seeded from ?q= so a shared/bookmarked URL restores the filter; kept local
  // after that (typing must not spam router.replace).
  const [q, setQ] = useState(initialQuery);

  // The URL is the source of truth; local state exists only so the tab
  // highlight moves before the RSC response lands.
  useEffect(() => setActive(activeCategory), [activeCategory]);

  const go = (category: MarketplaceCategoryId | null, net: NetworkFilter) => {
    setActive(category);
    startTransition(() => {
      router.replace(urlFor(category, net), { scroll: false });
    });
  };

  const needle = q.trim().toLowerCase();
  const visible = useMemo(
    () =>
      sections
        .filter((s) => !active || s.id === active)
        .map((s) => ({
          ...s,
          listings: needle
            ? s.listings.filter((l) =>
                `${l.name} ${l.description}`.toLowerCase().includes(needle),
              )
            : s.listings,
        })),
    [sections, active, needle],
  );

  return (
    <div className="space-y-10">
      {/* ── Controls ── */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Category">
          <Tab label="All categories" active={active === null} onClick={() => go(null, network)} />
          {MARKETPLACE_CATEGORIES.map((c) => (
            <Tab
              key={c.id}
              label={c.label}
              active={active === c.id}
              onClick={() => go(c.id, network)}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by name or description"
            aria-label="Filter agents"
            className="w-full max-w-[360px] rounded-lg deck border border-rule bg-paper px-3.5 py-2 font-mono text-[13px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
          <div
            className="flex items-center gap-1 font-mono text-[12px] uppercase tracking-[0.1em]"
            role="group"
            aria-label="Network"
          >
            <span className="mr-1 text-ink-faint">Network</span>
            {(
              [
                ["all", "All"],
                ["56", "BSC"],
                ["97", "Testnet"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => go(active, value)}
                aria-pressed={network === value}
                className={`rounded-full px-3 py-1 transition-colors ${
                  network === value
                    ? "bg-ink text-canvas"
                    : "text-ink-soft hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Category sections ── */}
      <div className={isPending ? "opacity-50 transition-opacity" : "transition-opacity"}>
        {visible.map((section, i) => {
          const category = MARKETPLACE_CATEGORIES.find((c) => c.id === section.id);
          if (!category) return null;
          return (
            <CategorySectionView
              key={section.id}
              index={i}
              category={category}
              section={section}
              network={network}
              filtered={Boolean(needle)}
            />
          );
        })}
      </div>
    </div>
  );
}

function Tab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-full border px-3.5 py-1.5 font-mono text-[12px] uppercase tracking-[0.1em] transition-colors ${
        active
          ? "border-ink bg-ink text-canvas"
          : "border-rule text-ink-soft hover:border-rule-strong hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function CategorySectionView({
  index,
  category,
  section,
  network,
  filtered,
}: {
  index: number;
  category: MarketplaceCategory;
  section: SerializedSection;
  network: NetworkFilter;
  filtered: boolean;
}) {
  return (
    <section id={category.id} className="border-t border-rule py-10 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="max-w-[560px]">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-faint">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span aria-hidden className="h-px w-7 bg-accent" />
            <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-accent">
              {category.metricLabel}
            </span>
          </div>
          <h2 className="mt-2.5 text-[22px] font-medium leading-tight tracking-[-0.01em] text-ink">
            {category.label}
          </h2>
          <p className="mt-1 text-[16px] leading-relaxed text-ink-mid">
            {category.blurb}
          </p>
        </div>
        <Button href={hireHref(category.deployCategoryId)} variant="accent" size="sm" arrow>
          Deploy an agent like this
        </Button>
      </div>

      {section.listings.length === 0 ? (
        <p className="mt-6 deck border border-rule bg-paper px-4 py-6 font-mono text-[12.5px] text-ink-soft">
          {filtered
            ? "No agents in this category match your filter."
            : "No agents indexed in this category yet."}
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {section.listings.map((l) => (
            <ListingCard key={`${l.chainId}:${l.tokenId}`} listing={l} />
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 font-mono text-[12px] text-ink-faint">
        <span>
          {section.listings.length} shown
          {section.externalTotal != null && section.externalTotal > section.listings.length
            ? ` of ~${section.externalTotal.toLocaleString("en-US")} indexed`
            : ""}
        </span>
        {section.capped && (
          <Link
            href={urlFor(category.id, network)}
            className="text-accent transition-colors hover:text-ink"
          >
            All {category.label.toLowerCase()} agents <span aria-hidden>&rarr;</span>
          </Link>
        )}
      </div>
    </section>
  );
}

function ListingCard({ listing: l }: { listing: MarketplaceListing }) {
  return (
    <Link
      href={`/agents/${l.chainId}/${l.tokenId}`}
      className="group flex flex-col deck border border-rule bg-paper p-4 transition-colors hover:border-accent focus-visible:border-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <AgentImage src={l.imageUrl} name={l.name} />
        <span className="font-mono text-[12px] uppercase tracking-[0.1em] text-ink-faint">
          {chainLabel(l.chainId)}
        </span>
      </div>

      <h3 className="mt-3 break-words text-[15px] font-medium leading-snug text-ink group-hover:text-accent">
        {l.name}
      </h3>

      {l.source === "decenchro" && (
        <span className="mt-1.5 inline-flex w-fit items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-0.5 font-mono text-[12px] text-accent">
          {l.live && (
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-signal animate-blink" />
          )}
          Deployed on Decenchro
        </span>
      )}

      <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-relaxed text-ink-mid">
        {l.description || "No description published."}
      </p>

      <div className="mt-auto flex items-baseline justify-between gap-2 pt-4 font-mono text-[12px] tabular-nums">
        {l.totalFeedbacks > 0 && l.averageScore != null ? (
          <span className="text-ink">
            <span aria-hidden className="text-accent">★</span>{" "}
            {Math.round(l.averageScore)}
            <span className="text-ink-faint"> /100 · {l.totalFeedbacks} fb</span>
          </span>
        ) : (
          <span className="text-ink-faint">no feedback yet</span>
        )}
        {l.lastActiveLabel && (
          <span className="text-ink-faint">{l.lastActiveLabel}</span>
        )}
      </div>

      {l.protocols.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {l.protocols.slice(0, 4).map((p) => (
            <span
              key={p}
              className="rounded-full border border-rule px-2 py-px font-mono text-[12px] uppercase tracking-[0.08em] text-ink-soft"
            >
              {p}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
