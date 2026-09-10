"use client";

import { useCallback, useRef, useState } from "react";

import { PanelLabel } from "@/components/dashboard/section-header";
import { ActionButton, Meta, Pill, PrimaryButton } from "@/components/dashboard/ui";
import { POLL_IDLE_MS, usePoll } from "@/components/dashboard/use-poll";
import type { AgentMetrics, BudgetInfo } from "@/lib/dashboard/agent-metrics";

// Live usage for one deployed agent, read from its own host. This used to be a
// whole section of its own (/dashboard/analytics), which listed the same roster
// as Fleet and made the operator hold two lists in their head to answer one
// question. It is now the tail of the Fleet card: the agent, then what it did.
//
// Keyed by deployment id rather than pubkey — the card already has the id, and
// on-chain-only signers have no deployment row, so the old pubkey roster showed
// them as permanently "unreachable".

type Loaded = {
  phase: "ok";
  metrics: AgentMetrics;
  budget: BudgetInfo | null;
};
type MetricsState =
  | { phase: "loading" }
  | Loaded
  | { phase: "error"; reason: string; budget: BudgetInfo | null };

// Keeps the last good data across a transient failure so the card doesn't flash
// empty. `tick` forces a refetch.
function useAgentMetrics(deploymentId: string, tick: number): MetricsState {
  const [state, setState] = useState<MetricsState>({ phase: "loading" });

  // Guards against a slow response landing after the id changed.
  const generation = useRef(0);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const r = await fetch(`/api/agent-metrics?id=${deploymentId}`, {
        cache: "no-store",
      });
      const data = await r.json();
      if (mine !== generation.current) return;
      if (data?.ok && data.metrics) {
        setState({
          phase: "ok",
          metrics: data.metrics as AgentMetrics,
          budget: (data.budget as BudgetInfo) ?? null,
        });
      } else {
        setState((prev) =>
          prev.phase === "ok"
            ? prev
            : {
                phase: "error",
                reason: data?.reason ?? "unreachable",
                budget: (data?.budget as BudgetInfo) ?? null,
              },
        );
      }
    } catch {
      if (mine !== generation.current) return;
      setState((prev) =>
        prev.phase === "ok"
          ? prev
          : { phase: "error", reason: "unreachable", budget: null },
      );
    }
  }, [deploymentId]);

  // `tick` is part of the key so a manual refresh forces a fetch.
  usePoll(load, POLL_IDLE_MS, true, `${deploymentId}:${tick}`);

  return state;
}

const fmt = (n: number) => n.toLocaleString("en-US");
const compact = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(1)}k`
      : String(n);
const usd = (n: number) => `$${n.toFixed(n < 10 ? 2 : n < 1000 ? 1 : 0)}`;

function sinceEpoch(sec: number | null): string {
  if (!sec) return "—";
  const s = Math.max(0, Date.now() / 1000 - sec);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function AgentAnalytics({
  deploymentId,
  canControl,
  provisioning,
  deleted,
}: {
  deploymentId: string;
  canControl: boolean;
  /** Still booting — there is no host to read yet, so say so instead of erroring. */
  provisioning?: boolean;
  /** Removed agents have no host at all; render nothing. */
  deleted?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tick, setTick] = useState(0);
  const state = useAgentMetrics(deploymentId, tick);

  if (deleted) return null;

  const loaded = state.phase === "ok" ? state : null;
  const budget = state.phase === "loading" ? null : state.budget;

  return (
    <>
      {loaded ? (
        <AgentMetricsStrip m={loaded.metrics} />
      ) : (
        <dl className="border-t border-console-rule px-4 py-3">
          <Meta label="Activity">
            <span className="text-console-faint">
              {provisioning
                ? "booting…"
                : state.phase === "loading"
                  ? "reading…"
                  : `host unreachable · ${(state as { reason: string }).reason}`}
            </span>
          </Meta>
        </dl>
      )}

      {(budget?.level !== "none" || canControl) && (
        <BudgetBar
          budget={budget}
          deploymentId={deploymentId}
          canControl={canControl}
          onChange={() => setTick((t) => t + 1)}
        />
      )}

      {loaded && (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="flex min-h-10 w-full items-center gap-2 border-t border-console-rule px-4 py-2.5 text-left font-mono text-[12.5px] text-console-mid transition-colors hover:text-accent-bright"
          >
            <span
              className={`transition-transform ${expanded ? "rotate-90" : ""}`}
              aria-hidden
            >
              ›
            </span>
            {expanded ? "Hide usage detail" : "Usage detail"}
          </button>
          {expanded && <DetailPanel m={loaded.metrics} />}
        </>
      )}
    </>
  );
}

// Five cells on one wrapping flex row stacked raggedly at phone widths — a grid
// keeps the labels in columns all the way down.
function AgentMetricsStrip({ m }: { m: AgentMetrics }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-console-rule px-4 py-3 sm:grid-cols-3 lg:grid-cols-5">
      <Meta label="Messages">
        <span className="tabular-nums">{fmt(m.totals.messages)}</span>
      </Meta>
      <Meta label="Tool calls">
        <span className="tabular-nums">{fmt(m.totals.toolCalls)}</span>
      </Meta>
      <Meta label="Tokens">
        <span className="tabular-nums">
          {compact(m.tokens.input + m.tokens.output)}
        </span>
      </Meta>
      {/* "Model cost", not "Cost": the row above already has a Spent cell in
          credits, which includes runtime and the markup. Two different correct
          numbers under the same word read as a bug. */}
      <Meta
        label="Model cost"
        title="The provider's raw USD for this agent's model calls, as the agent reports it. No runtime, no markup — so it does not match Spent."
      >
        <span className="tabular-nums">${m.tokens.costUsd.toFixed(2)}</span>
      </Meta>
      <Meta label="Last active">{sinceEpoch(m.totals.lastActive)}</Meta>
      {/* Five zeros and a dash read as a broken page, not as an agent nobody has
          talked to yet. The distinction matters because "unreachable" renders
          somewhere else entirely, so a reader has no way to tell them apart. */}
      {m.totals.sessions === 0 && m.totals.messages === 0 && (
        <p className="col-span-full font-mono text-[12px] leading-relaxed text-console-faint">
          {idleReason(m)}
        </p>
      )}
    </dl>
  );
}

/**
 * Why an agent with no activity has no activity. Three different situations
 * produced the same five zeros, and only one of them was "nobody has used it":
 *
 *  - unclaimed: Hermes gates unknown Telegram users through its pairing files,
 *    so the agent is answering NOBODY until an owner is paired.
 *  - claimed but idle: the owner's first message was spent on pairing and never
 *    reached the model, so it has to be sent again.
 *  - Telegram down: no transport at all.
 */
function idleReason(m: AgentMetrics): string {
  if (m.claimed === false)
    return "No owner yet. Message the agent on Telegram to claim it: the first message pairs you and the second one gets an answer.";
  if (telegramState(m) !== "connected")
    return "No conversations yet, and Telegram is not connected — check the bot token above.";
  if (m.claimed === true)
    return "Owner paired, no conversations yet. If your first message only got a pairing code, send it again — that one was used to pair you.";
  return "No conversations yet. Message the agent on Telegram and its usage lands here.";
}

/** Telegram's reported state, or null when the agent said nothing about it. */
function telegramState(m: AgentMetrics): string | null {
  return m.gateway?.platforms?.telegram?.state ?? null;
}

// ─── Budget bar ──────────────────────────────────────────────

function BudgetBar({
  budget,
  deploymentId,
  canControl,
  onChange,
}: {
  budget: BudgetInfo | null;
  deploymentId: string;
  canControl: boolean;
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (raw: string | null) => {
    setSaving(true);
    try {
      await fetch("/api/agent-budget", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deploymentId,
          budgetUsd: raw == null || raw === "" ? null : Number(raw),
        }),
      });
      onChange();
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const has = budget && budget.budgetUsd != null;
  const pct = budget?.pct != null ? Math.min(1, budget.pct) : 0;
  const fill =
    budget?.level === "over"
      ? "bg-danger"
      : budget?.level === "warn"
        ? "bg-warn"
        : "bg-accent-bright";

  return (
    <div className="border-t border-console-rule px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="label-micro text-console-faint">Budget</span>

        {has ? (
          <>
            <span className="flex-1 basis-40">
              <span className="flex h-1.5 w-full bg-console-rule">
                <span
                  className={`h-full transition-all duration-500 ${fill}`}
                  style={{ width: `${pct * 100}%` }}
                />
              </span>
            </span>
            <span className="font-mono text-[12.5px] tabular-nums text-console-ink">
              {usd(budget!.spentUsd)}
              <span className="text-console-faint"> / {usd(budget!.budgetUsd!)}</span>
              {budget!.level === "over" && (
                <span className="text-danger"> · over</span>
              )}
              {budget!.level === "warn" && (
                <span className="text-warn-ink"> · {Math.round(pct * 100)}%</span>
              )}
              <span className="text-console-faint"> · this month</span>
            </span>
            {canControl && (
              <ActionButton
                onClick={() => {
                  setValue(String(budget!.budgetUsd));
                  setEditing((v) => !v);
                }}
              >
                edit
              </ActionButton>
            )}
          </>
        ) : (
          canControl &&
          !editing && (
            <ActionButton onClick={() => setEditing(true)}>
              set a monthly cap
            </ActionButton>
          )
        )}
      </div>

      {editing && canControl && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[12.5px] text-console-faint">$</span>
          <input
            type="number"
            min={0}
            step="1"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="50"
            className="w-24 min-h-11 rounded-lg border border-console-rule bg-console px-3 py-2 font-mono text-[12.5px] text-console-ink placeholder:text-console-faint focus:border-accent-bright focus:outline-none md:min-h-0"
          />
          <span className="font-mono text-[12px] text-console-faint">/mo</span>
          <PrimaryButton disabled={saving} onClick={() => save(value)}>
            Save
          </PrimaryButton>
          {has && (
            <ActionButton disabled={saving} onClick={() => save(null)}>
              clear
            </ActionButton>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Expanded detail ─────────────────────────────────────────

function DetailPanel({ m }: { m: AgentMetrics }) {
  return (
    <div className="space-y-5 border-t border-console-rule px-4 py-4">
      <div className="grid gap-5 sm:grid-cols-2">
        <Sparkline daily={m.daily} />
        <TokenBreakdown m={m} />
      </div>

      {(m.bySource.length > 0 || m.byModel.length > 0) && (
        <div className="grid gap-5 sm:grid-cols-2">
          {m.bySource.length > 0 && (
            <Breakdown
              label="By source"
              rows={m.bySource.map((s) => ({
                name: s.source,
                detail: `${fmt(s.messages)} msgs · ${fmt(s.sessions)} sess`,
              }))}
            />
          )}
          {m.byModel.length > 0 && (
            <Breakdown
              label="By model"
              rows={m.byModel.map((s) => ({
                name: s.model,
                detail: `${fmt(s.sessions)} sess`,
              }))}
            />
          )}
        </div>
      )}

      {m.recent.length > 0 && <RecentFeed m={m} />}
    </div>
  );
}

function Sparkline({ daily }: { daily: AgentMetrics["daily"] }) {
  const label = <PanelLabel>Messages · 14 days</PanelLabel>;
  if (daily.length === 0)
    return (
      <div>
        {label}
        <p className="mt-2 font-mono text-[12px] text-console-faint">
          No daily data yet.
        </p>
      </div>
    );
  const max = Math.max(1, ...daily.map((d) => d.messages));
  const w = 100;
  const h = 34;
  const step = daily.length > 1 ? w / (daily.length - 1) : 0;
  const pts = daily
    .map((d, i) => `${(i * step).toFixed(1)},${(h - (d.messages / max) * h).toFixed(1)}`)
    .join(" ");
  const cost = daily.reduce((s, d) => s + d.cost, 0);
  return (
    <div>
      {label}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="mt-2 h-10 w-full"
        aria-hidden
      >
        <polyline
          points={pts}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <p className="mt-1 font-mono text-[12px] text-console-faint">
        {usd(cost)} model cost over the window
      </p>
    </div>
  );
}

function TokenBreakdown({ m }: { m: AgentMetrics }) {
  const rows: [string, string][] = [
    ["Input", fmt(m.tokens.input)],
    ["Output", fmt(m.tokens.output)],
    ["Cache read", fmt(m.tokens.cacheRead)],
    ["Cache write", fmt(m.tokens.cacheWrite)],
    // "Model cost", not "Spent": this is the provider's raw USD as the agent
    // itself reports it, with no runtime and no markup. The card's "Spent" cell
    // is credits and contains both, so the bare word made two correct numbers
    // look like a bug.
    ["Model cost this month", usd(m.spendMonth)],
    ["Model cost all-time", usd(m.tokens.costUsd)],
  ];
  return (
    <div>
      <PanelLabel>Tokens &amp; cost</PanelLabel>
      <dl className="mt-2 divide-y divide-console-rule border-t border-console-rule">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-1.5">
            <dt className="font-mono text-[12.5px] text-console-mid">{k}</dt>
            <dd className="font-mono text-[12.5px] tabular-nums text-console-ink">
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Breakdown({
  label,
  rows,
}: {
  label: string;
  rows: { name: string | null; detail: string }[];
}) {
  return (
    <div>
      <PanelLabel>{label}</PanelLabel>
      <dl className="mt-2 divide-y divide-console-rule border-t border-console-rule">
        {rows.map((r, i) => (
          <div key={i} className="flex justify-between gap-4 py-1.5">
            <dt className="truncate font-mono text-[12.5px] text-console-mid">
              {r.name || "—"}
            </dt>
            <dd className="shrink-0 font-mono text-[12.5px] tabular-nums text-console-faint">
              {r.detail}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function RecentFeed({ m }: { m: AgentMetrics }) {
  return (
    <div>
      <PanelLabel>Recent activity</PanelLabel>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {m.recent.slice(0, 20).map((r, i) => (
          <span key={i} title={new Date(r.ts * 1000).toLocaleString()}>
            <Pill>{r.tool ? `⚙ ${r.tool}` : r.role}</Pill>
          </span>
        ))}
      </div>
    </div>
  );
}
