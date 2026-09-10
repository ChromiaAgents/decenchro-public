"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";

import { agentCategory } from "@/lib/dashboard/agent-categories";
import type { ManagedAgent } from "@/lib/dashboard/deployments";
import { creditsUsdLabel } from "@/lib/dashboard/credits";

import { managedTone, uptime, uptimeMinutes } from "./agent-status";
import { Pill } from "./ui";

// The Fleet roster as a dense sortable table (user decision 2026-08-23, "look
// like GCP console"): a filter toolbar, a sortable header, one row per agent.
//
// A row expands to the agent's existing card rather than to a second copy of its
// details. That card owns the Telegram handle lookup, the Hermes login fetch and
// the lifecycle buttons, all with their own in-flight and error state; rebuilding
// any of it as table cells would have meant two sources of truth for the same
// actions. So the table is the summary and the card is the detail.
//
// Below `sm` the table becomes the card list outright — a six-column grid at
// 390px is unreadable however it wraps.

type SortKey = "name" | "status" | "uptime" | "spent" | "created";

/** Sort values are derived once per render, so the comparator stays cheap. */
type Sortable = {
  m: ManagedAgent;
  name: string;
  status: string;
  createdMs: number;
  /** Minutes, for ordering — the cell still shows the formatted string. */
  uptimeMins: number;
  spent: number;
};

function Th({
  children,
  sortKey,
  active,
  dir,
  onSort,
  className = "",
}: {
  children: ReactNode;
  sortKey?: SortKey;
  active?: boolean;
  dir?: "asc" | "desc";
  onSort?: (k: SortKey) => void;
  className?: string;
}) {
  const label = (
    <span className="inline-flex items-center gap-1">
      {children}
      {/* The caret only renders on the sorted column, so the header row does
          not read as six identical controls. */}
      {active && (
        <span aria-hidden className="text-accent">
          {dir === "asc" ? "▲" : "▼"}
        </span>
      )}
    </span>
  );
  return (
    <th
      scope="col"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
      className={`label-micro whitespace-nowrap border-b border-console-rule px-3 py-2 text-left font-normal text-console-faint ${className}`}
    >
      {sortKey && onSort ? (
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className="inline-flex items-center gap-1 [text-transform:inherit] transition-colors hover:text-accent"
        >
          {label}
        </button>
      ) : (
        label
      )}
    </th>
  );
}

export function FleetTable({
  managed,
  renderDetail,
  filterPlaceholder = "Filter agents",
}: {
  managed: ManagedAgent[];
  /** The expanded row's contents — the agent's existing card. */
  renderDetail: (m: ManagedAgent) => ReactNode;
  filterPlaceholder?: string;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "created",
    dir: "desc",
  });
  const [open, setOpen] = useState<string | null>(null);

  const onSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : // Text sorts read best ascending, magnitudes descending.
          { key, dir: key === "name" || key === "status" ? "asc" : "desc" },
    );

  const rows = useMemo<Sortable[]>(() => {
    const needle = q.trim().toLowerCase();
    const base = managed
      .map((m) => ({
        m,
        name: m.agentName.toLowerCase(),
        status: managedTone(m.status).label,
        createdMs: Date.parse(m.createdAt) || 0,
        // -1 so rows with no honest uptime sort to one end rather than
        // interleaving with real durations.
        uptimeMins: uptimeMinutes(m) ?? -1,
        spent: m.creditsSpent ?? -1,
      }))
      // Matches what the row actually shows, plus the id, so pasting a
      // deployment id from a log finds its agent.
      .filter(
        (r) =>
          !needle ||
          r.name.includes(needle) ||
          r.status.includes(needle) ||
          r.m.id.toLowerCase().includes(needle) ||
          agentCategory(r.m.categoryId).label.toLowerCase().includes(needle) ||
          String(r.m.erc8004AgentId ?? "").includes(needle),
      );
    const mul = sort.dir === "asc" ? 1 : -1;
    return base.sort((a, b) => {
      switch (sort.key) {
        case "name":
          return a.name.localeCompare(b.name) * mul;
        case "status":
          return a.status.localeCompare(b.status) * mul;
        case "uptime":
          return (a.uptimeMins - b.uptimeMins) * mul;
        case "spent":
          return (a.spent - b.spent) * mul;
        default:
          return (a.createdMs - b.createdMs) * mul;
      }
    });
  }, [managed, q, sort]);

  const hidden = managed.length - rows.length;

  return (
    <div className="deck border border-console-rule bg-console">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-console-rule px-3 py-2">
        <span aria-hidden className="text-console-faint">
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
          >
            <path d="M3 5h18M6 12h12M10 19h4" />
          </svg>
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={filterPlaceholder}
          aria-label="Filter agents"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-console-ink placeholder:text-console-faint focus:outline-none"
        />
        <span className="label-micro shrink-0 text-console-faint">
          {hidden > 0
            ? `${rows.length} of ${managed.length}`
            : `${managed.length} ${managed.length === 1 ? "agent" : "agents"}`}
        </span>
      </div>

      {/* ── Table (sm and up) ── */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr>
              <Th sortKey="name" active={sort.key === "name"} dir={sort.dir} onSort={onSort}>
                Name
              </Th>
              <Th sortKey="status" active={sort.key === "status"} dir={sort.dir} onSort={onSort}>
                Status
              </Th>
              <Th>Type</Th>
              <Th sortKey="uptime" active={sort.key === "uptime"} dir={sort.dir} onSort={onSort}>
                Uptime
              </Th>
              <Th sortKey="spent" active={sort.key === "spent"} dir={sort.dir} onSort={onSort}>
                Spent
              </Th>
              <Th>ERC-8004</Th>
              <Th className="w-10">
                <span className="sr-only">Details</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ m }) => {
              const tone = managedTone(m.status);
              const expanded = open === m.id;
              return (
                // Keyed on the Fragment, not the row: a bare <> cannot take a
                // key, and React then warns for every agent in the table.
                <Fragment key={m.id}>
                  {/* The whole row toggles, not just the chevron — a 40px target
                      at the far right of a 720px row is a needle. role="row"
                      supports aria-expanded, so the row itself is the control
                      and the caret is decoration; that also keeps one tab stop
                      per agent instead of two. */}
                  <tr
                    onClick={() => setOpen(expanded ? null : m.id)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      // Space scrolls the page otherwise.
                      e.preventDefault();
                      setOpen(expanded ? null : m.id);
                    }}
                    tabIndex={0}
                    aria-expanded={expanded}
                    aria-label={`${expanded ? "Hide" : "Show"} details for ${m.agentName}`}
                    className={`cursor-pointer border-b border-console-rule transition-colors focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-accent ${
                      expanded ? "bg-accent-soft/40" : "hover:bg-console-deep"
                    }`}
                  >
                    <td className="max-w-52 truncate px-3 py-2 font-sans text-[13.5px] font-medium text-console-ink">
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <span
                          aria-hidden
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`}
                        />
                        <span className="truncate" title={m.agentName}>
                          {m.agentName}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Pill
                        tone={
                          m.status === "running"
                            ? "accent"
                            : m.status === "failed"
                              ? "danger"
                              : "neutral"
                        }
                      >
                        {tone.label}
                      </Pill>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[12.5px] text-console-mid">
                      {agentCategory(m.categoryId).label}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[12.5px] tabular-nums text-console-ink">
                      {uptime(m)}
                    </td>
                    <td
                      className="whitespace-nowrap px-3 py-2 font-mono text-[12.5px] tabular-nums text-console-ink"
                      title={
                        m.creditsSpentSplit
                          ? `${creditsUsdLabel(m.creditsSpentSplit.runtime)} runtime + ${creditsUsdLabel(m.creditsSpentSplit.model)} model (marked up 1.2x). Expand the row for the provider's raw model cost, which does not match this.`
                          : undefined
                      }
                    >
                      {m.creditsSpent != null ? creditsUsdLabel(m.creditsSpent) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[12.5px]">
                      {m.erc8004AgentId != null ? (
                        <span className="text-accent">#{m.erc8004AgentId}</span>
                      ) : m.erc8004Tx ? (
                        <span
                          className="text-console-faint"
                          title={`register() ${m.erc8004Tx} broadcast, waiting on the receipt`}
                        >
                          confirming
                        </span>
                      ) : m.status === "running" || m.status === "starting" ? (
                        <span
                          className="text-console-faint"
                          title="The deploy ran out of its time budget; the attest cron retries it."
                        >
                          queued
                        </span>
                      ) : (
                        <span className="text-console-faint">—</span>
                      )}
                    </td>
                    <td className="px-1 py-2 text-right">
                      <span
                        aria-hidden
                        className="inline-flex h-8 w-8 items-center justify-center text-console-mid"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </span>
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="border-b border-console-rule">
                      <td colSpan={7} className="bg-console-deep p-3">
                        {renderDetail(m)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-6 font-mono text-[12.5px] text-console-soft"
                >
                  {managed.length === 0
                    ? "No agents deployed yet."
                    : `No agent matches "${q}".`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Cards (below sm) ── */}
      <div className="space-y-3 p-3 sm:hidden">
        {rows.map(({ m }) => (
          <div key={m.id}>{renderDetail(m)}</div>
        ))}
        {rows.length === 0 && (
          <p className="font-mono text-[12.5px] text-console-soft">
            {managed.length === 0
              ? "No agents deployed yet."
              : `No agent matches "${q}".`}
          </p>
        )}
      </div>
    </div>
  );
}
