"use client";

import { useEffect, useRef, useState } from "react";

import { timeAgo } from "@/lib/marketplace/types";

// Client islands for the agent detail page: copyable endpoint rows and the
// live activity panel (15s poll against /api/marketplace/live — the page
// itself revalidates on a slower cadence).

export function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard denied: the text is selectable either way.
    }
  };

  return (
    <div className="flex items-stretch deck border border-rule bg-paper">
      <div className="min-w-0 flex-1 px-3 py-2.5">
        <div className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-faint">
          {label}
        </div>
        <div className="mt-0.5 break-all font-mono text-[12.5px] leading-relaxed text-ink">
          {value}
        </div>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className={`shrink-0 border-l border-rule px-3 font-mono text-[12px] uppercase tracking-[0.1em] transition-colors ${
          copied ? "text-accent" : "text-ink-soft hover:bg-canvas hover:text-ink"
        }`}
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}

type LiveResponse = {
  ok: boolean;
  lastActive: string | null;
  reputation: { clients: number; count: number; score: number | null } | null;
  latestFeedback: {
    score: number | null;
    tag: string | null;
    txHash: string | null;
    submittedAt: string | null;
  } | null;
  decenchro: {
    status: string;
    live: boolean;
    lastSeen: string | null;
    guardedActions: number | null;
  } | null;
  readAt: string;
};

const POLL_MS = 15_000;

export function LivePanel({
  chainId,
  tokenId,
  explorerTxBase,
  initial,
}: {
  chainId: number;
  tokenId: string;
  /** e.g. https://bscscan.com/tx/ (client stays free of server imports). */
  explorerTxBase: string;
  initial: LiveResponse | null;
}) {
  const [data, setData] = useState<LiveResponse | null>(initial);
  const [updatedAgo, setUpdatedAgo] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch(
          `/api/marketplace/live?chainId=${chainId}&tokenId=${tokenId}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const body = (await res.json()) as LiveResponse;
        if (alive && body.ok) setData(body);
      } catch {
        // keep showing the last good read
      }
    };
    const interval = setInterval(load, POLL_MS);
    load();
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [chainId, tokenId]);

  // Relative labels tick client-side only (post-mount), so SSR and hydration
  // render the same markup.
  useEffect(() => {
    const tick = () =>
      setUpdatedAgo(data ? timeAgo(data.lastActive, Date.now()) : null);
    tick();
    const t = setInterval(tick, 10_000);
    return () => clearInterval(t);
  }, [data]);

  const fb = data?.latestFeedback ?? null;
  const rep = data?.reputation ?? null;
  const dec = data?.decenchro ?? null;

  return (
    <div className="deck border border-rule bg-paper">
      <div className="flex items-center gap-2 border-b border-rule px-4 py-2.5">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-signal animate-blink" />
        <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-faint">
          Live activity
        </span>
        <span className="ml-auto font-mono text-[12px] text-ink-faint">
          refreshes every 15s
        </span>
      </div>
      <dl className="divide-y divide-rule">
        <LiveRow label="Last active" value={updatedAgo ?? "no signal yet"} />
        {dec && (
          <LiveRow
            label="Agent status"
            value={dec.live ? "running" : dec.status}
            accent={dec.live}
          />
        )}
        {dec?.guardedActions != null && (
          <LiveRow
            label="Guarded actions"
            value={`${dec.guardedActions.toLocaleString("en-US")} on record`}
          />
        )}
        <LiveRow
          label="On-chain reputation"
          value={
            rep
              ? rep.count > 0
                ? `${rep.count.toLocaleString("en-US")} feedbacks · avg ${
                    rep.score != null ? Math.round(rep.score) : "—"
                  }/100`
                : "no feedback recorded"
              : "registry unreachable"
          }
        />
        <div className="px-4 py-3">
          <dt className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-faint">
            Latest feedback
          </dt>
          <dd className="mt-1 font-mono text-[12.5px] leading-relaxed text-ink">
            {fb ? (
              <>
                {fb.score != null ? `${fb.score}/100` : "unscored"}
                {fb.tag ? ` · ${fb.tag}` : ""}
                {fb.txHash && (
                  <>
                    {" · "}
                    <a
                      href={`${explorerTxBase}${fb.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
                    >
                      tx {fb.txHash.slice(0, 10)}…
                    </a>
                  </>
                )}
              </>
            ) : (
              <span className="text-ink-faint">
                none in the chain&apos;s recent feed
              </span>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function LiveRow({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="px-4 py-3">
      <dt className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-faint">
        {label}
      </dt>
      <dd
        className={`mt-1 font-mono text-[12.5px] leading-relaxed tabular-nums ${
          accent ? "text-accent" : "text-ink"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
