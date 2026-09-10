"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, type Transition } from "framer-motion";

import { SectionHeader } from "@/components/dashboard/section-header";
import {
  ActionButton,
  Banner,
  Panel,
  PanelHead,
  Pill,
  PrimaryButton,
} from "@/components/dashboard/ui";
import { buttonClasses } from "@/components/site/button";
import { ContactButton } from "@/components/site/contact-modal";
import type { LedgerEntry } from "@/lib/dashboard/credit-ledger";
import { openEmbeddedCheckout } from "@/lib/dashboard/embedded-checkout";
import {
  PACKS,
  RUNTIME_BLOCK_MINUTES,
  conversationsFor,
  RUNTIME_CREDITS_PER_HOUR,
  SETTLEMENT_ASSETS,
  SIGNUP_GRANT_CREDITS,
  creditsToUsd,
  creditsUsdLabel,
  type SettlementAsset,
} from "@/lib/dashboard/credits";
import type { PlanSummary } from "@/lib/dashboard/plan";

const SPRING: Transition = { type: "spring", stiffness: 110, damping: 22 };
const STAGGER = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.02 } },
};
const RISE = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: SPRING },
};

// The one input treatment, matching the deploy form and the marketplace filter.
const INPUT =
  "min-h-11 rounded-lg border border-console-rule bg-console px-3.5 py-2 font-mono text-[13px] text-console-ink placeholder:text-console-faint focus:border-accent-bright focus:outline-none md:min-h-0";

const RECOMMENDED_PACK = "team";

const LEVEL_COPY: Record<string, string> = {
  empty: "Your balance is empty. Agents are paused until you top up.",
  critical: "Almost out of credits. Top up to keep your agents running.",
  warn: "Running low on credits.",
};

const KIND_LABEL: Record<string, string> = {
  grant: "Welcome credits",
  topup: "Top up",
  runtime: "Agent runtime",
  llm: "Model usage",
  adjustment: "Adjustment",
};

function fmt(n: number): string {
  return n.toLocaleString();
}

// "19 Aug, 12:59" rather than a full locale timestamp. The year is almost always
// this year and the seconds never matter, so both are noise on a one-line row.
function compactDate(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

export function BillingView({
  canControl,
  reason,
  initialSummary,
}: {
  canControl: boolean;
  reason?: string | null;
  initialSummary?: PlanSummary;
}) {
  const [summary, setSummary] = useState<PlanSummary | null>(initialSummary ?? null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [asset, setAsset] = useState<SettlementAsset>("chr");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Match on what the row actually shows, so a search behaves the way the eye
  // does: type "runtime" and you get the rows labelled runtime.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ledger;
    return ledger.filter((e) =>
      `${e.note ?? ""} ${KIND_LABEL[e.kind] ?? e.kind}`.toLowerCase().includes(q),
    );
  }, [ledger, query]);

  const fromDeploy = reason === "deploy";
  const balance = summary?.balance ?? 0;
  const level = summary?.level ?? "empty";
  const enterprise = summary?.plan === "enterprise";

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/credits", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { summary: PlanSummary; ledger: LedgerEntry[] };
      setSummary(body.summary);
      setLedger(body.ledger);
    } catch {
      /* keep the seeded view */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("topup");
    if (!id) return;
    setPending(id);
    let tries = 0;
    const timer = setInterval(async () => {
      tries++;
      try {
        const res = await fetch(`/api/credits/payment?id=${id}`, { cache: "no-store" });
        const body = (await res.json()) as { status?: string };
        if (body.status === "confirmed" || body.status === "overpaid") {
          setPending(null);
          clearInterval(timer);
          void refresh();
          return;
        }
      } catch {
        /* retry */
      }
      if (tries >= 20) {
        setPending(null);
        clearInterval(timer);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  const topUp = useCallback(
    async (packId: string) => {
      setBusy(packId);
      setError(null);
      try {
        const res = await fetch("/api/credits/checkout", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ packId, asset }),
        });
        const body = (await res.json()) as {
          paymentId?: string;
          checkoutUrl?: string;
          error?: string;
        };
        if (!res.ok || !body.checkoutUrl) {
          setError(body.error ?? "Could not start checkout.");
          return;
        }
        // Embedded checkout: the payer stays on this page and the credits land
        // under them. Allowed here because the embedding page and the payment's
        // success_url are the same origin, which Chromia Pay requires.
        //
        // Falls back to the full redirect whenever the widget cannot run — the
        // script is blocked, the CDN is down, an older browser. Losing the modal
        // must never mean losing the ability to pay.
        const embedded = await openEmbeddedCheckout(body.checkoutUrl, {
          onPaid: () => {
            // The webhook is what credits the account; this only stops the
            // operator staring at a stale balance.
            if (body.paymentId) setPending(body.paymentId);
            void refresh();
          },
          onClose: () => void refresh(),
        });
        if (!embedded) window.location.href = body.checkoutUrl;
      } catch {
        setError("Network error.");
      } finally {
        setBusy(null);
      }
    },
    [asset, refresh],
  );

  return (
    <motion.div initial="hidden" animate="visible" variants={STAGGER} className="space-y-10">
      <motion.div variants={RISE}>
        <SectionHeader
          title="Credits"
          description="Prepaid credits for agent runtime and model use."
          aside={enterprise ? <Pill tone="accent">enterprise</Pill> : undefined}
        />
      </motion.div>

      {/* Balance. No card: the number is the hierarchy, and a hairline separates
          it more quietly than a box would. Split so the figure and what it means
          for the fleet read as one line rather than a stack. */}
      <motion.div
        variants={RISE}
        className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-console-rule pb-8"
      >
        <div>
          {/* Dollars, not credits. The credit is still the internal unit and
              the ledger below is still denominated in it, but "966 cr" makes the
              reader convert before they know whether they can afford an agent.
              The old layout had the credit count large and the dollar value as a
              footnote; this swaps that, and the footnote no longer repeats it. */}
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[52px] leading-none tracking-tight tabular-nums text-console-ink">
              {creditsUsdLabel(balance)}
            </span>
          </div>
          <p className="mt-2 font-mono text-[12.5px] tabular-nums text-console-soft">
            Prepaid balance for runtime and model use
          </p>
        </div>
        <div className="max-w-[36ch] text-left sm:text-right">
          {summary?.runwayHours != null && (
            <p className="text-[14px] text-console-mid">
              About {summary.runwayHours} hours left at your current usage.
            </p>
          )}
          {LEVEL_COPY[level] && !enterprise && (
            <p className="mt-1 text-[14px] text-warn-ink">{LEVEL_COPY[level]}</p>
          )}
          {pending && (
            <p className="mt-1 font-mono text-[12.5px] text-accent-bright">
              Waiting for the payment to confirm on chain
            </p>
          )}
        </div>
      </motion.div>

      {fromDeploy && level === "empty" && !enterprise && (
        <motion.p variants={RISE} className="-mt-4 text-[14px] text-console-mid">
          Your first {creditsUsdLabel(SIGNUP_GRANT_CREDITS)} was on us. Top up to deploy
          again.
        </motion.p>
      )}

      {/* One panel, three cells. Three free-floating cards of equal weight give
          the operator nothing to decide with, so the packs share a frame, one is
          anchored as recommended, and the settlement mark is stated once in the
          footer rather than repeated per card. The section carries the animation
          and the Panel the material, so the card comes from one place. */}
      <motion.section variants={RISE}>
        <Panel>
          <PanelHead
            aside={
              <span
                role="group"
                aria-label="Settlement asset"
                className="flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1.5"
              >
                <span className="label-micro mr-1 text-console-faint">Pay with</span>
                {SETTLEMENT_ASSETS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setAsset(a)}
                    aria-pressed={asset === a}
                    className={`inline-flex min-h-11 items-center rounded-full px-3 font-mono text-[12px] uppercase tracking-[0.1em] transition-colors md:min-h-0 md:py-1 ${
                      asset === a
                        ? "bg-console-ink text-console"
                        : "text-console-soft hover:text-console-ink"
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </span>
            }
          >
            Top up
          </PanelHead>

          {/* Hairline bleed: the grid's own background shows through the 1px gaps,
              so the three cells divide with no per-cell borders to double up. */}
          <div className="grid grid-cols-1 gap-px bg-console-rule sm:grid-cols-3">
            {PACKS.map((pack) => {
              const featured = pack.id === RECOMMENDED_PACK;
              const label = busy === pack.id ? "opening" : "Top up";
              return (
                <div
                  key={pack.id}
                  className={`flex flex-col px-5 py-6 ${
                    featured ? "bg-accent-soft" : "bg-console"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-[15px] font-medium text-console-ink">
                      {pack.label}
                    </h4>
                    {featured ? (
                      <span className="label-micro text-accent-bright">Recommended</span>
                    ) : (
                      pack.bonusPct > 0 && (
                        <span className="font-mono text-[12.5px] tabular-nums text-console-soft">
                          +{pack.bonusPct}%
                        </span>
                      )
                    )}
                  </div>

                  <p className="mt-4 font-mono text-[32px] leading-none tabular-nums text-console-ink">
                    ${pack.usd}
                  </p>
                  {/* Same unit as the price above it, which is the point of the
                      change: a bonus tier now reads as "$52.50 of credit" beside
                      its own $50, instead of asking the reader what 5,250 is. */}
                  <p className="mt-3 text-[14px] text-console-mid">
                    {creditsUsdLabel(pack.credits)} of credit
                    {featured && pack.bonusPct > 0 ? `, +${pack.bonusPct}% free` : ""}
                  </p>
                  <p className="mt-1 text-[14px] text-console-soft">
                    about {fmt(conversationsFor(pack.credits))} conversations
                  </p>

                  {/* The title sits on the wrapper: PrimaryButton takes no title
                      prop, and a read-only operator needs the reason either way. */}
                  <div
                    className="mt-6 pt-1"
                    title={canControl ? undefined : "Read-only access"}
                  >
                    {featured ? (
                      <PrimaryButton
                        disabled={busy !== null || !canControl}
                        onClick={() => topUp(pack.id)}
                      >
                        {label}
                      </PrimaryButton>
                    ) : (
                      <ActionButton
                        disabled={busy !== null || !canControl}
                        onClick={() => topUp(pack.id)}
                      >
                        {label}
                      </ActionButton>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-console-rule px-4 py-3.5">
            <p className="text-[14px] text-console-mid">
              {creditsUsdLabel(RUNTIME_CREDITS_PER_HOUR)} an hour while an agent
              is live, plus what the model costs. Billed in{" "}
              {RUNTIME_BLOCK_MINUTES} minute blocks.
            </p>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-[14px] text-console-mid">
              Powered by
              <img
                src="/logos/chromia.png"
                alt=""
                width={13}
                height={13}
                loading="lazy"
                className="h-3.25 w-3.25 rounded-xs object-contain"
              />
              Chromia Pay
            </span>
          </footer>
        </Panel>
      </motion.section>

      {error && <Banner tone="danger">{error}</Banner>}

      {/* Activity. One line per entry, five visible, the rest behind a scroll.
          A ledger grows without bound, so it gets a window rather than a page
          that keeps getting longer. Two lines per row and a full timestamp were
          the two things making it heavy, so the date is compact and sits on the
          same line as the amount — three columns wide, stacked at phone width
          where three columns cannot fit. */}
      <motion.div variants={RISE}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h3 className="text-[22px] font-medium tracking-[-0.01em] text-console-ink">
            Activity
          </h3>
          {ledger.length > 0 && (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search activity"
              className={`${INPUT} w-full max-w-50`}
            />
          )}
        </div>

        {ledger.length === 0 ? (
          <p className="mt-3 text-[14px] text-console-mid">
            No charges yet. Runtime and model use appear here as they are billed.
          </p>
        ) : shown.length === 0 ? (
          <p className="mt-3 text-[14px] text-console-mid">
            Nothing matches {`"${query}"`}.
          </p>
        ) : (
          // Taller rows below sm, so the row can stack and still show five of
          // them in the window.
          <div className="mt-3 [--ledger-row:56px] sm:[--ledger-row:44px]">
            {/* Columns are only named where they line up, which is the row's
                three-column form at sm and above. */}
            <div className="hidden items-center gap-4 border-b border-console-rule pb-2 sm:flex">
              <span className="label-micro flex-1 text-console-faint">Entry</span>
              <span className="label-micro w-26 shrink-0 text-right text-console-faint">
                Date
              </span>
              <span className="label-micro w-14 shrink-0 text-right text-console-faint">
                Amount
              </span>
            </div>
            <ul
              // 5 rows at a time. Scrolls rather than paginates, because a ledger
              // is read by scanning backwards, not by jumping to a page number.
              className="max-h-[calc(5*var(--ledger-row))] divide-y divide-console-rule overflow-y-auto"
            >
              {shown.map((entry) => (
                <li
                  key={entry.id}
                  className="flex h-(--ledger-row) flex-col justify-center gap-1 sm:flex-row sm:items-center sm:gap-4"
                >
                  <span className="min-w-0 truncate text-[14px] text-console-ink sm:flex-1">
                    {entry.note ?? KIND_LABEL[entry.kind] ?? entry.kind}
                  </span>
                  {/* Below sm the two data cells share a line under the entry;
                      `contents` promotes them back to row columns at sm and up. */}
                  <span className="flex items-baseline gap-3 sm:contents">
                    {/* w-26 was 16px short of "Aug 22, 03:45 AM" at 12.5px mono,
                        so the nowrap spilled the date over the amount column.
                        Sized to the longest value the formatter can produce. */}
                    <span className="shrink-0 whitespace-nowrap font-mono text-[12.5px] tabular-nums text-console-soft sm:w-32 sm:text-right">
                      {compactDate(entry.createdAt)}
                    </span>
                    <span
                      className={`shrink-0 font-mono text-[12.5px] tabular-nums sm:w-20 sm:text-right ${
                        entry.delta >= 0 ? "text-accent-bright" : "text-console-mid"
                      }`}
                    >
                      {creditsUsdLabel(entry.delta, true)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </motion.div>

      {/* Enterprise is the secondary path, so it gets a row rather than a second
          tinted panel competing with the packs above. */}
      <motion.div
        variants={RISE}
        className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-console-rule pt-6"
      >
        <div className="max-w-[52ch]">
          <h3 className="text-[22px] font-medium tracking-[-0.01em] text-console-ink">
            Enterprise
          </h3>
          <p className="mt-1 text-[14px] text-console-mid">
            Many agents with no cap, credits on invoice, and priority support.
          </p>
        </div>
        {/* ContactButton is styled by class, not by component, so it takes the
            shared pill recipe: ink rather than teal, to sit behind the top-up. */}
        <ContactButton
          label="Contact us"
          subject="Decenchro Enterprise enquiry (dashboard)"
          className={buttonClasses("primary", "sm", "min-h-11 md:min-h-0")}
        />
      </motion.div>

      {!canControl && (
        <p className="text-[14px] text-console-soft">
          Buying credits requires admin access.
        </p>
      )}
    </motion.div>
  );
}
