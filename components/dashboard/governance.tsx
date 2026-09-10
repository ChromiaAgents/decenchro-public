"use client";

import {
  animate,
  motion,
  useMotionValue,
  useTransform,
  type Transition,
} from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ActionButton,
  Meta,
  Panel,
  PanelHead,
  Pill,
  Stat,
} from "@/components/dashboard/ui";
import { POLL_IDLE_MS, usePoll } from "@/components/dashboard/use-poll";
import type { Governance } from "@/lib/dashboard/governance";
import type { AgentTag, ToolCallRecord } from "@/lib/dashboard/atbash";
import type { Decision } from "@/lib/dashboard/decision";

const SPRING: Transition = { type: "spring", stiffness: 110, damping: 22 };
const STAGGER = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.02 } },
};
const RISE = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: SPRING },
};

// The filter row's controls. Text fields are the one rounded non-pill the
// marketplace allows, so they get their own shape rather than a panel's.
const FIELD =
  "min-h-11 rounded-lg border border-console-rule bg-console px-3 py-2 font-mono text-[12.5px] text-console-ink focus:border-accent-bright focus:outline-none md:min-h-0";

type AuditFeed = {
  ok: boolean;
  reason?: string;
  records: ToolCallRecord[];
  agents?: AgentTag[];
};

export function GovernanceView({
  scopedAgentPubkey,
}: {
  scopedAgentPubkey?: string;
} = {}) {
  const [gov, setGov] = useState<Governance | null>(null);
  const [feed, setFeed] = useState<AuditFeed | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [g, f] = await Promise.all([
        fetch("/api/governance", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/audits?limit=60", { cache: "no-store" }).then((r) =>
          r.json(),
        ),
      ]);
      if (!g?.error) setGov(g);
      setFeed(f);
    } catch {
      // keep last good data
    } finally {
      setLoading(false);
    }
  }, []);

  // The audit feed is append-only and the posture changes only when an operator
  // edits it, so it moves far more slowly than any poll cadence.
  usePoll(refresh, POLL_IDLE_MS);

  if (loading && !gov) {
    return (
      <Panel>
        <p className="px-4 py-10 text-center font-mono text-[12.5px] text-console-faint">
          loading…
        </p>
      </Panel>
    );
  }

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={STAGGER}
      className="space-y-6"
    >
      {gov && <IdentityBanner gov={gov} />}
      {gov?.posture && <Posture gov={gov} />}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        {gov?.policy && <PolicyPanel gov={gov} />}
        {gov && <HeldQueue gov={gov} />}
      </div>
      <RiskFeed
        feed={feed}
        tier={gov?.identity.tier ?? null}
        scopedAgentPubkey={scopedAgentPubkey}
      />
    </motion.div>
  );
}

// ─── Identity / tier banner ──────────────────────────────────

function IdentityBanner({ gov }: { gov: Governance }) {
  const { identity } = gov;
  const enforced = identity.enforcementEnabled;
  return (
    <motion.div variants={RISE}>
      <Panel>
        <PanelHead
          aside={
            <span
              className={`inline-flex items-center gap-2 font-mono text-[12px] ${
                enforced ? "text-signal" : "text-warn-ink"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  enforced ? "bg-signal" : "bg-warn"
                }`}
              />
              {enforced ? "blocking risky actions" : "watching only"}
            </span>
          }
        >
          Identity
        </PanelHead>

        {/* Was three label/value pairs on one wrapping row, which collided with
            the status line on a phone. */}
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-3">
          <Meta label="Agent">{identity.fingerprint ?? "not set"}</Meta>
          <Meta label="Org">{identity.org}</Meta>
          <Meta label="Plan">
            <span className="text-accent-bright">
              {identity.tier ?? "unknown"}
            </span>
          </Meta>
        </dl>

        {!enforced && (
          <p className="border-t border-console-rule px-4 py-2.5 font-mono text-[12px] text-console-soft">
            recorded &amp; checked, never blocked. Enforcement adds blocking and
            holds.
          </p>
        )}
      </Panel>
    </motion.div>
  );
}

// ─── Risk posture ────────────────────────────────────────────

function Posture({ gov }: { gov: Governance }) {
  const p = gov.posture!;
  const total = p.green + p.yellow + p.red;
  const coverage =
    p.totalToolCalls > 0
      ? Math.round((p.totalJudgments / p.totalToolCalls) * 100)
      : 0;

  return (
    <motion.div variants={RISE}>
      <Panel>
        <PanelHead
          aside={
            <span className="font-mono text-[12px] text-console-faint">
              {coverage}% of {p.totalToolCalls.toLocaleString()} actions checked
            </span>
          }
        >
          Safety record
        </PanelHead>

        <div className="px-4 py-4">
          {/* Rule, not paper: the old track was the same white as the panel, so
              the unfilled remainder read as nothing at all. */}
          <div className="flex h-2.5 w-full overflow-hidden bg-console-rule">
            <Seg value={p.green} total={total} className="bg-signal" />
            <Seg value={p.yellow} total={total} className="bg-warn" />
            <Seg value={p.red} total={total} className="bg-danger" />
          </div>
        </div>

        {/* Hand-rolled rather than StatStrip: three cells never divide evenly
            into its two-column phone grid, and the empty cell shows through as
            a rule-coloured block. Left-to-right order carries the same
            safe/caution/blocked mapping as the bar above. */}
        <dl className="grid grid-cols-1 gap-px border-t border-console-rule bg-console-rule sm:grid-cols-3">
          <Stat label="Allowed" value={<CountUp value={p.green} />} />
          <Stat label="Needs approval" value={<CountUp value={p.yellow} />} />
          <Stat
            label="Blocked"
            value={
              <span className={p.red > 0 ? "text-danger" : undefined}>
                <CountUp value={p.red} />
              </span>
            }
          />
        </dl>
      </Panel>
    </motion.div>
  );
}

function Seg({
  value,
  total,
  className,
}: {
  value: number;
  total: number;
  className: string;
}) {
  if (total === 0 || value === 0) return null;
  return (
    <motion.div
      className={className}
      initial={{ width: 0 }}
      animate={{ width: `${(value / total) * 100}%` }}
      transition={SPRING}
    />
  );
}

// A number that counts up to its value instead of snapping.
function CountUp({ value }: { value: number }) {
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => Math.round(v).toLocaleString());
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.7, ease: "easeOut" });
    return () => c.stop();
  }, [mv, value]);
  return <motion.span>{text}</motion.span>;
}

// ─── Policy panel ────────────────────────────────────────────

function PolicyPanel({ gov }: { gov: Governance }) {
  const p = gov.policy!;
  return (
    <motion.div variants={RISE} className="min-w-0">
      <Panel className="h-full">
        <PanelHead
          aside={
            <span className="flex flex-wrap items-center justify-end gap-1.5">
              {p.risk && <Pill>risk · {p.risk}</Pill>}
              <Pill tone={p.isCustom ? "accent" : "neutral"}>
                {p.isCustom ? "custom" : "default"}
              </Pill>
              {p.isJailed && <WarnPill>jailed</WarnPill>}
            </span>
          }
        >
          The rules
        </PanelHead>
        <ul className="divide-y divide-console-rule">
          {p.rules.length === 0 && (
            <li className="px-4 py-3 font-mono text-[12.5px] text-console-faint">
              no rules found
            </li>
          )}
          {p.rules.map((r) => (
            <li key={r.code} className="flex gap-3 px-4 py-3">
              <span className="label-micro mt-0.5 w-14 shrink-0 text-accent-bright">
                {r.code}
              </span>
              <RuleBody text={r.text} />
            </li>
          ))}
        </ul>
      </Panel>
    </motion.div>
  );
}

// `warn` is a light amber that fails on the paper ground, so anything that has
// to be read uses `warn-ink`. Pill has no warn tone, hence this local one.
function WarnPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-warn-ink/40 px-2.5 py-0.5 font-mono text-[12px] text-warn-ink">
      {children}
    </span>
  );
}

// Rule text arrives as "<$10:GREEN, bank transfer>$100:RED." — split it into
// one chip per clause, with the verdict as a colored dot instead of a word.
// Anything that doesn't parse falls back to plain text.
const CHIP_DOT: Record<string, string> = {
  GREEN: "bg-signal",
  YELLOW: "bg-warn",
  RED: "bg-danger",
};

function parseClauses(
  text: string,
): { cond: string; color: string }[] | null {
  const out: { cond: string; color: string }[] = [];
  for (const part of text.split(",")) {
    const seg = part.trim().replace(/\.$/, "");
    if (!seg) continue;
    const i = seg.lastIndexOf(":");
    if (i === -1) return null;
    const color = seg.slice(i + 1).trim().toUpperCase();
    const cond = seg.slice(0, i).trim();
    if (!CHIP_DOT[color] || !cond) return null;
    out.push({ cond, color });
  }
  return out.length > 0 ? out : null;
}

function RuleBody({ text }: { text: string }) {
  const clauses = useMemo(() => parseClauses(text), [text]);
  if (!clauses) {
    return (
      <span className="text-[14px] leading-relaxed text-console-mid">{text}</span>
    );
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {clauses.map((c, i) => (
        <span key={i} title={`${c.cond} → ${c.color}`}>
          <Pill>
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${CHIP_DOT[c.color]}`}
            />
            {c.cond}
          </Pill>
        </span>
      ))}
    </span>
  );
}

// ─── Human-in-the-loop queue ─────────────────────────────────

function HeldQueue({ gov }: { gov: Governance }) {
  const { pending, reviewed, items } = gov.held;
  return (
    <motion.div variants={RISE} className="min-w-0">
      <Panel className="flex h-full flex-col">
        <PanelHead
          aside={
            <span className="flex flex-wrap items-center justify-end gap-2">
              <span className="font-mono text-[12px] text-console-faint">
                {pending} waiting · {reviewed} done
              </span>
              {pending > 0 && <WarnPill>action needed</WarnPill>}
            </span>
          }
        >
          Needs your review
        </PanelHead>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-6 w-6 text-signal"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="m8.5 12.5 2.5 2.5 5-5.5" />
            </svg>
            <p className="label-micro text-console-faint">
              all clear · nothing held
            </p>
          </div>
        ) : (
          <ul className="max-h-72 divide-y divide-console-rule overflow-auto">
            {items.map((h) => (
              <li key={h.judgmentId} className="px-4 py-3">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <WarnPill>{h.verdict || "HOLD"}</WarnPill>
                  <span className="font-mono text-[12px] text-console-faint">
                    {h.agent ?? "—"} ·{" "}
                    {h.createdAt ? relativeTime(h.createdAt) : "—"}
                  </span>
                </div>
                <p className="break-all text-[14px] leading-snug text-console-ink">
                  {h.actionText || "(no action text)"}
                </p>
                {h.reason && (
                  <p className="mt-1 text-[14px] leading-snug text-console-mid">
                    {h.reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="border-t border-console-rule px-4 py-2.5 font-mono text-[12px] leading-relaxed text-console-faint">
          approve or reject in the Atbash console
        </p>
      </Panel>
    </motion.div>
  );
}

// ─── Risk feed (filters + export) ────────────────────────────

type VerdictFilter = "all" | "allow" | "hold" | "block" | "none";

function RiskFeed({
  feed,
  tier,
  scopedAgentPubkey,
}: {
  feed: AuditFeed | null;
  tier: string | null;
  scopedAgentPubkey?: string;
}) {
  const [verdict, setVerdict] = useState<VerdictFilter>("all");
  const [tool, setTool] = useState("");
  const [agent, setAgent] = useState(scopedAgentPubkey ?? "all");
  const [showFilters, setShowFilters] = useState(Boolean(scopedAgentPubkey));

  // Follow the Fleet drill-in scope: narrow to that agent and reveal the filter
  // row. Clearing the scope ("whole fleet") resets the feed to all agents too,
  // so the view never contradicts the scope bar.
  useEffect(() => {
    setAgent(scopedAgentPubkey ?? "all");
    if (scopedAgentPubkey) setShowFilters(true);
  }, [scopedAgentPubkey]);

  const records = feed?.ok ? feed.records : [];
  const agents = feed?.agents ?? [];
  const filtered = useMemo(() => {
    return records.filter((r) => {
      if (agent !== "all" && r.agentPubkey !== agent) return false;
      if (tool && !r.toolName.toLowerCase().includes(tool.toLowerCase()))
        return false;
      if (verdict === "all") return true;
      const v = verdictClass(r.verdict);
      return v === verdict;
    });
  }, [records, verdict, tool, agent]);

  const activeFilters =
    (agent !== "all" ? 1 : 0) + (tool ? 1 : 0) + (verdict !== "all" ? 1 : 0);

  return (
    <motion.div variants={RISE}>
      <Panel>
        {/* Not PanelHead: three controls plus a live count need to wrap as a
            group, which its single-row aside can't do. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-console-rule px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="label-micro text-console-faint">Activity log</h3>
            <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-console-faint">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-bright" />
              live · {filtered.length}
              {activeFilters > 0 ? `/${records.length}` : ""} action
              {records.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton onClick={() => setShowFilters((s) => !s)}>
              filters{activeFilters > 0 ? ` · ${activeFilters}` : ""}
            </ActionButton>
            <ActionButton
              onClick={() => exportRecords(filtered, "csv")}
              disabled={filtered.length === 0}
            >
              csv
            </ActionButton>
            <ActionButton
              onClick={() => exportRecords(filtered, "json")}
              disabled={filtered.length === 0}
            >
              json
            </ActionButton>
          </div>
        </div>

        {showFilters && (
          <div className="flex flex-wrap items-center gap-2 border-b border-console-rule bg-console-deep px-4 py-3">
            <select
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
              aria-label="Filter by agent"
              className={FIELD}
            >
              <option value="all">all agents</option>
              {agents.map((a) => (
                <option key={a.pubkey} value={a.pubkey}>
                  {a.fingerprint} ({a.count})
                </option>
              ))}
            </select>
            <input
              value={tool}
              onChange={(e) => setTool(e.target.value)}
              placeholder="filter by tool…"
              aria-label="Filter by tool"
              spellCheck={false}
              className={`${FIELD} w-full placeholder:text-console-faint sm:w-44`}
            />
            <select
              value={verdict}
              onChange={(e) => setVerdict(e.target.value as VerdictFilter)}
              aria-label="Filter by result"
              className={FIELD}
            >
              <option value="all">all results</option>
              <option value="allow">allowed</option>
              <option value="hold">held for review</option>
              <option value="block">blocked</option>
              <option value="none">no decision</option>
            </select>
            {activeFilters > 0 && (
              <span className="sm:ml-auto">
                <ActionButton
                  onClick={() => {
                    setAgent("all");
                    setTool("");
                    setVerdict("all");
                  }}
                >
                  clear
                </ActionButton>
              </span>
            )}
          </div>
        )}

        <div className="max-h-96 overflow-auto bg-console-deep px-4 py-3 font-mono text-[12px] leading-relaxed">
          {!feed && <p className="text-console-faint">loading…</p>}
          {feed && !feed.ok && (
            <p className="text-warn-ink">! {feed.reason ?? "unavailable"}</p>
          )}
          {feed?.ok && records.length === 0 && (
            <p className="text-console-faint">
              nothing recorded yet · talk to the agent.
            </p>
          )}
          {feed?.ok && records.length > 0 && filtered.length === 0 && (
            <p className="text-console-faint">no records match the filter.</p>
          )}
          {filtered.map((r, i) => (
            <FeedLine key={`${r.toolCallId ?? r.id ?? "x"}-${i}`} r={r} tier={tier} />
          ))}
        </div>
      </Panel>
    </motion.div>
  );
}

function FeedLine({ r, tier }: { r: ToolCallRecord; tier: string | null }) {
  const [open, setOpen] = useState(false);
  const [dec, setDec] = useState<Decision | null>(null);
  const [loading, setLoading] = useState(false);

  const ts = r.createdAt
    ? new Date(r.createdAt).toISOString().slice(11, 19)
    : "--:--:--";
  const cls = verdictClass(r.verdict);
  const label = r.verdict
    ? r.verdict.toUpperCase()
    : tier === "audit"
      ? "AUDIT"
      : "—";
  const tone =
    cls === "block"
      ? "text-danger"
      : cls === "hold"
        ? "text-warn-ink"
        : cls === "allow"
          ? "text-accent-bright"
          : "text-console-mid";
  const cmd = parseCommand(r.command);
  const expandable = Boolean(r.toolCallId);

  const toggle = async () => {
    if (!expandable) return;
    const next = !open;
    setOpen(next);
    if (next && !dec) {
      setLoading(true);
      try {
        const d = await fetch(
          `/api/decision?id=${encodeURIComponent(r.toolCallId!)}`,
          { cache: "no-store" },
        ).then((x) => x.json());
        setDec(d);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div>
      <div
        onClick={toggle}
        className={`whitespace-pre-wrap py-px ${
          expandable ? "cursor-pointer hover:text-console-ink" : ""
        }`}
      >
        <span className="text-console-faint">
          {expandable ? (open ? "▾" : "▸") : " "}
        </span>{" "}
        <span className="text-console-faint">{ts}</span>{" "}
        {r.agent && (
          <>
            <span className="text-accent-bright">{r.agent}</span>{" "}
          </>
        )}
        <span className={tone}>[{label}]</span>{" "}
        <span className="text-console-ink">{r.toolName}</span>
        {cmd && (
          <>
            <span className="text-console-faint"> » </span>
            <span className="text-console-mid">{cmd}</span>
          </>
        )}
        {r.reason && <span className="text-console-faint"> · {r.reason}</span>}
      </div>
      {open && <DecisionCard dec={dec} loading={loading} tier={tier} />}
    </div>
  );
}

function DecisionCard({
  dec,
  loading,
  tier,
}: {
  dec: Decision | null;
  loading: boolean;
  tier: string | null;
}) {
  if (loading && !dec)
    return (
      <div className="my-1 ml-4 font-mono text-[12px] text-console-faint">
        loading record…
      </div>
    );
  if (!dec || !dec.found)
    return (
      <div className="my-1 ml-4 font-mono text-[12px] text-console-faint">
        record not found.
      </div>
    );
  const v = dec.verdict;
  // Paper inside the recessed log pane, so an expanded record reads as a
  // document lifted out of the stream.
  return (
    <div className="my-2 ml-4 space-y-1 border border-console-rule bg-console px-3 py-2.5 font-mono text-[12px] leading-relaxed">
      <DField k="tool" v={dec.toolName} />
      <DField k="args" v={dec.args} />
      {dec.context && <DField k="context" v={dec.context} />}
      <DField k="decision">
        {v.color ? (
          <span className="text-console-ink">
            {v.color}
            {v.reason ? ` · ${v.reason}` : ""}
            {v.source ? ` · ${v.source}` : ""}
            {v.responseMs ? ` · ${v.responseMs}ms` : ""}
          </span>
        ) : (
          <span className="text-console-faint">
            {tier === "audit"
              ? "watching only · recorded, not checked"
              : "no decision"}
          </span>
        )}
      </DField>
      {dec.resultStatus && <DField k="result" v={dec.resultStatus} />}
      <DField
        k="recorded"
        v={
          dec.createdAt
            ? new Date(dec.createdAt).toISOString().slice(0, 19).replace("T", " ")
            : "—"
        }
      />
      <DField k="agent" v={dec.agent ?? "—"} />
      <DField k="chain·id" v={dec.toolCallId} />
    </div>
  );
}

function DField({
  k,
  v,
  children,
}: {
  k: string;
  v?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
      <span className="label-micro shrink-0 pt-px text-console-faint sm:w-24">
        {k}
      </span>
      <span className="min-w-0 flex-1 break-all text-console-mid">
        {children ?? v}
      </span>
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const m = Math.floor((Date.now() - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function verdictClass(verdict: string): "allow" | "hold" | "block" | "none" {
  const v = verdict.toUpperCase();
  if (v === "BLOCK" || v === "RED") return "block";
  if (v === "HOLD" || v === "YELLOW") return "hold";
  if (v === "ALLOW" || v === "GREEN") return "allow";
  return "none";
}

function parseCommand(raw: string): string {
  if (!raw) return "";
  try {
    const j = JSON.parse(raw);
    if (typeof j === "object" && j !== null) {
      for (const k of ["command", "path", "url", "query", "content"]) {
        const v = (j as Record<string, unknown>)[k];
        if (typeof v === "string") return v.length > 90 ? v.slice(0, 90) + "…" : v;
      }
    }
  } catch {
    /* fall through */
  }
  return raw.length > 90 ? raw.slice(0, 90) + "…" : raw;
}

function exportRecords(records: ToolCallRecord[], format: "csv" | "json") {
  let blob: Blob;
  let ext: string;
  if (format === "json") {
    blob = new Blob([JSON.stringify(records, null, 2)], {
      type: "application/json",
    });
    ext = "json";
  } else {
    const cols = [
      "time",
      "agent",
      "tool_call_id",
      "tool",
      "verdict",
      "reason",
      "command",
      "context",
    ];
    const esc = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
    const rows = records.map((r) =>
      [
        r.createdAt ?? "",
        r.agentPubkey ?? r.agent ?? "",
        r.toolCallId ?? "",
        r.toolName,
        r.verdict,
        r.reason,
        r.command,
        r.context,
      ]
        .map((c) => esc(String(c)))
        .join(","),
    );
    blob = new Blob([[cols.join(","), ...rows].join("\n")], {
      type: "text/csv",
    });
    ext = "csv";
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `decenchro-audit-trail.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}
