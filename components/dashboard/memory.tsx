"use client";

import { motion, type Transition } from "framer-motion";
import { useCallback, useEffect, useState } from "react";

import { POLL_IDLE_MS, usePoll } from "@/components/dashboard/use-poll";
import { liveness, relative } from "@/components/dashboard/agent-status";
import { SectionHeader } from "@/components/dashboard/section-header";
import {
  ActionButton,
  Banner,
  EmptyState,
  Meta,
  Panel,
  PanelHead,
  Pill,
  Stat,
} from "@/components/dashboard/ui";
import {
  useCompanyAgents,
  type CompanyAgent,
} from "@/components/dashboard/use-company-agents";
import type { AuditEntry, MemoryEntry, MemoryOverview } from "@/lib/dashboard/memory";

const SPRING: Transition = { type: "spring", stiffness: 110, damping: 22 };
const STAGGER = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.02 } },
};
const RISE = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: SPRING },
};

export function MemoryView() {
  const { agents } = useCompanyAgents();
  // Which deployed agent's store we're looking at; null until one is picked.
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<MemoryOverview | null>(null);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  // Every agent is remote: default to the first deployed one.
  useEffect(() => {
    if (selected === null && agents.length > 0) setSelected(agents[0].pubkey);
  }, [selected, agents]);

  // Nothing to read: nothing selected/deployed.
  const noSelection = selected === null;

  const refresh = useCallback(async () => {
    if (noSelection) {
      setLoading(false);
      return;
    }
    try {
      const r = await fetch(`/api/memory?agent=${selected}`, {
        cache: "no-store",
      });
      const json = (await r.json()) as MemoryOverview & { error?: string };
      if (json.error === "no-namespace") {
        setLocked(true);
        setData(null);
        setErrored(false);
      } else if (!json.error) {
        setLocked(false);
        setData(json);
        setErrored(false);
      } else {
        // A named error from the API with no usable payload.
        setErrored(true);
      }
    } catch {
      // Network/parse failure — flag it (but keep any last-good data on screen).
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, [noSelection, selected]);

  // Switching agents shows the loading state again; the `key` makes usePoll
  // refetch straight away rather than waiting out the current interval.
  useEffect(() => {
    setLoading(true);
  }, [selected]);
  usePoll(refresh, POLL_IDLE_MS, true, selected ?? "");

  return (
    <motion.div initial="hidden" animate="visible" variants={STAGGER} className="space-y-6">
      <AgentPicker agents={agents} selected={selected} onSelect={setSelected} />

      {noSelection ? (
        <EmptyState>
          No agents yet. Deploy an agent to see its on-chain memory here.
        </EmptyState>
      ) : loading && !data && !locked ? (
        <Panel>
          <p className="px-4 py-10 text-center font-mono text-[12.5px] text-console-faint">
            loading memory…
          </p>
        </Panel>
      ) : errored && !data && !locked ? (
        <div className="space-y-3">
          <Banner tone="warn">
            Couldn&rsquo;t load this agent&rsquo;s memory. The chain or host may
            be unreachable.
          </Banner>
          <ActionButton
            onClick={() => {
              setLoading(true);
              refresh();
            }}
          >
            retry
          </ActionButton>
        </div>
      ) : locked ? (
        <EmptyState>
          This agent keeps its memories private. They aren&rsquo;t readable with
          your key.
        </EmptyState>
      ) : data ? (
        <>
          <ChainHeader data={data} />
          <DailyLog audit={data.audit} entries={data.entries} ok={data.ok} />
          <MemoryList entries={data.entries} ok={data.ok} reason={data.reason} />
        </>
      ) : null}
    </motion.div>
  );
}

// ─── Agent picker (bento) ────────────────────────────────────

// Memories are per-agent. Pick whose store to read: the company's deployed +
// on-chain agents. Clicking a tile loads that agent's memories below.
function AgentPicker({
  agents,
  selected,
  onSelect,
}: {
  agents: CompanyAgent[];
  selected: string | null;
  onSelect: (pubkey: string | null) => void;
}) {
  const total = agents.length;

  return (
    <motion.div variants={RISE} className="space-y-4">
      <SectionHeader
        title="Memory"
        description="On-chain memory: one store per agent."
        aside={
          <span className="font-mono text-[12px] text-console-faint">
            {total > 0 ? `pick an agent · ${total} total` : "no agents"}
          </span>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {agents.map((a) => {
          const t = memoryTile(a);
          return (
            <AgentTile
              key={a.pubkey}
              fingerprint={t.fingerprint}
              sub={t.sub}
              dot={t.dot}
              active={selected?.toLowerCase() === a.pubkey.toLowerCase()}
              onClick={() => onSelect(a.pubkey)}
            />
          );
        })}
      </div>
    </motion.div>
  );
}

// A deployed agent shows its name + lifecycle status; an on-chain-only agent
// shows its fingerprint + activity.
function memoryTile(a: CompanyAgent): {
  fingerprint: string;
  sub: string;
  dot: string;
} {
  if (a.status) {
    const dot =
      a.status === "running"
        ? "bg-signal"
        : a.status === "failed"
          ? "bg-warn"
          : a.status === "stopped"
            ? "bg-console-rule"
            : "bg-accent-bright"; // provisioning / starting / stopping / pending
    return { fingerprint: a.name || a.fingerprint, sub: a.status, dot };
  }
  const s = liveness(a.lastActive);
  return {
    fingerprint: a.fingerprint,
    sub: `${(a.actions ?? 0).toLocaleString()} actions · ${relative(a.lastActive)}`,
    dot: s.dot,
  };
}

function AgentTile({
  fingerprint,
  sub,
  dot,
  active,
  onClick,
}: {
  fingerprint: string;
  sub: string;
  dot: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-h-11 flex-col gap-1.5 border px-3 py-2.5 text-left transition-colors ${
        active
          ? "border-accent-bright bg-accent-soft"
          : "border-console-rule bg-console hover:border-accent-bright"
      }`}
    >
      <span className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <span
          className={`truncate font-mono text-[12.5px] ${
            active ? "text-console-ink" : "text-console-mid"
          }`}
        >
          {fingerprint}
        </span>
      </span>
      <span className="truncate font-mono text-[12px] text-console-faint">{sub}</span>
    </button>
  );
}

// ─── Chain header ────────────────────────────────────────────

function ChainHeader({ data }: { data: MemoryOverview }) {
  const { ok } = data;
  // Latest memory write — the freshest updated_at (falling back to created_at).
  const latest = data.entries.reduce(
    (max, e) => Math.max(max, e.updated_at || e.created_at),
    0,
  );
  const dated = ok && latest > 0;
  return (
    <motion.div variants={RISE}>
      <Panel>
        <PanelHead
          aside={
            <span
              className={`inline-flex items-center gap-1.5 font-mono text-[12px] ${
                ok ? "text-signal" : "text-warn-ink"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-signal" : "bg-warn"}`} />
              {ok ? "connected" : "not connected"}
            </span>
          }
        >
          On-chain store
        </PanelHead>

        {/* Every agent is identified by its Atbash key. It rides in its own cell
            rather than the head: a 64-char key in a tracked-out micro-label
            overflows the strip. */}
        <dl className="border-b border-console-rule px-4 py-3">
          <Meta label="Owner key" title={data.owner ?? undefined}>
            {data.owner ?? "—"}
          </Meta>
        </dl>

        {/* Hand-rolled rather than StatStrip: nested in a panel, the row above
            already draws the top edge, so a full border would double up. */}
        <dl className="grid grid-cols-1 gap-px bg-console-rule sm:grid-cols-2">
          <Stat label="Memories" value={ok ? data.count.toLocaleString() : "—"} />
          <Stat
            label="Last updated"
            value={
              <>
                {dated ? relative(new Date(latest).toISOString()) : "—"}
                <span className="block font-mono text-[12px] text-console-faint">
                  {dated
                    ? `${dayLabel(latest)} · ${timeOfDay(latest)}`
                    : "no memories yet"}
                </span>
              </>
            }
          />
        </dl>

        {!ok && data.reason && (
          <p className="border-t border-console-rule px-4 py-2.5 font-mono text-[12px] text-warn-ink">
            {data.reason} · start it with{" "}
            <span className="text-console-mid">cd chain &amp;&amp; chr node start</span>
          </p>
        )}
      </Panel>
    </motion.div>
  );
}

// ─── Memory list ─────────────────────────────────────────────

function MemoryList({
  entries,
  ok,
  reason,
}: {
  entries: MemoryEntry[];
  ok: boolean;
  reason?: string;
}) {
  return (
    <motion.div variants={RISE}>
      <Panel>
        <PanelHead aside={`${entries.length} shown`}>Stored memories</PanelHead>
        {entries.length === 0 ? (
          <p className="px-4 py-8 text-center font-mono text-[12.5px] text-console-faint">
            {ok ? "no memories saved yet." : reason ?? "can't reach the chain."}
          </p>
        ) : (
          <ul className="divide-y divide-console-rule">
            {entries.map((m) => (
              <li key={m.entry_id} className="px-4 py-3">
                <p className="text-[14px] leading-relaxed text-console-ink">{m.content}</p>
                <MemoryMeta m={m} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </motion.div>
  );
}

function MemoryMeta({ m }: { m: MemoryEntry }) {
  const tags = m.tags.split(",").map((t) => t.trim()).filter(Boolean);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-[12px] text-console-faint">
      <span className="label-micro">{m.source}</span>
      <span>conf {m.confidence}</span>
      {tags.map((t) => (
        <Pill key={t}>{t}</Pill>
      ))}
      <span className="ml-auto">{blockTime(m.created_at)}</span>
    </div>
  );
}

// ─── Daily log (on-chain audit, as a journal) ────────────────

// Each on-chain action mapped to a plain-English verb, an accent tone, and a
// timeline dot colour.
function eventMeta(action: string): { verb: string; text: string; dot: string } {
  switch (action) {
    case "store":
      return { verb: "Remembered", text: "text-console-ink", dot: "bg-accent-bright" };
    case "update":
      return { verb: "Updated", text: "text-console-ink", dot: "bg-accent-bright" };
    case "delete":
      return { verb: "Forgot", text: "text-warn-ink", dot: "bg-warn" };
    case "create_namespace":
      return { verb: "Namespace created", text: "text-console-mid", dot: "bg-console-faint" };
    case "update_policy":
      return { verb: "Read policy changed", text: "text-console-mid", dot: "bg-console-faint" };
    default:
      return { verb: action.replace(/_/g, " "), text: "text-console-mid", dot: "bg-console-faint" };
  }
}

type DayGroup = { key: string; ts: number; events: AuditEntry[] };

function groupByDay(audit: AuditEntry[]): DayGroup[] {
  const sorted = [...audit].sort((a, b) => b.created_at - a.created_at);
  const groups: DayGroup[] = [];
  const index = new Map<string, DayGroup>();
  for (const ev of sorted) {
    const d = new Date(ev.created_at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    let g = index.get(key);
    if (!g) {
      g = { key, ts: ev.created_at, events: [] };
      index.set(key, g);
      groups.push(g);
    }
    g.events.push(ev);
  }
  return groups;
}

function dayLabel(ts: number): string {
  const start = (n: number) => {
    const d = new Date(n);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const diffDays = Math.round((start(Date.now()) - start(ts)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function timeOfDay(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function blockTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const d = new Date(ms);
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function DailyLog({
  audit,
  entries,
  ok,
}: {
  audit: AuditEntry[];
  entries: MemoryEntry[];
  ok: boolean;
}) {
  if (!ok) return null;
  const byId = new Map(entries.map((e) => [e.entry_id, e]));
  const days = groupByDay(audit);

  return (
    <motion.div variants={RISE}>
      <Panel>
        <PanelHead
          aside={`${audit.length} event${audit.length === 1 ? "" : "s"}`}
        >
          Daily log
        </PanelHead>

        {days.length === 0 ? (
          <p className="px-4 py-8 text-center font-mono text-[12.5px] text-console-faint">
            no activity yet.
          </p>
        ) : (
          <div className="divide-y divide-console-rule">
            {days.map((day) => (
              <div key={day.key} className="px-4 py-3">
                <div className="mb-2 flex items-baseline gap-2">
                  <span className="label-micro text-console-ink">
                    {dayLabel(day.ts)}
                  </span>
                  <span className="font-mono text-[12px] text-console-faint">
                    {day.events.length} change{day.events.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="ml-1 space-y-0.5 border-l border-console-rule">
                  {day.events.map((ev, i) => (
                    <LogEvent
                      key={`${ev.entry_id}-${ev.created_at}-${i}`}
                      ev={ev}
                      entry={byId.get(ev.entry_id)}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </motion.div>
  );
}

function LogEvent({ ev, entry }: { ev: AuditEntry; entry?: MemoryEntry }) {
  const meta = eventMeta(ev.action);
  const tags = (entry?.tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  // What was affected: the memory's content if we can resolve it, else the
  // raw detail line, else nothing.
  const body = entry?.content ?? (ev.detail || null);

  return (
    <li className="relative py-1.5 pl-4">
      {/* The panel is paper now, so the dot's cut-out ring follows it. */}
      <span
        className={`absolute -left-[4.5px] top-3 h-2 w-2 rounded-full ring-2 ring-console ${meta.dot}`}
      />
      <div className="flex items-baseline justify-between gap-3">
        <span className={`text-[14px] font-medium ${meta.text}`}>
          {meta.verb}
        </span>
        <span className="shrink-0 font-mono text-[12px] tabular-nums text-console-faint">
          {timeOfDay(ev.created_at)}
        </span>
      </div>
      {body && (
        <p className="mt-1 text-[14px] leading-relaxed text-console-mid">{body}</p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-[12px] text-console-faint">
        {entry && <span>conf {entry.confidence}</span>}
        {tags.map((t) => (
          <Pill key={t}>{t}</Pill>
        ))}
        <span className="ml-auto">by {ev.actor}</span>
      </div>
    </li>
  );
}
