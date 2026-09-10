"use client";

import type { ReactNode } from "react";

import { buttonClasses } from "@/components/site/button";

// Shared console primitives, in the marketplace's material: white panels on a
// warm canvas, flat and shadowless with a 10px `deck` radius, mono
// micro-labels, teal as the only signal.
//
// Every one of these existed two to five times over as hand-rolled markup with
// drifting padding and label sizes (a 9px label here, an 11px one there). One
// implementation each, so a material change lands in one place.

/* ── Panels ───────────────────────────────────────────────────────────── */

/**
 * The card. `bg-console` is paper on this surface, so a panel reads as sitting
 * above the ground on fill and hairline alone — flat, no shadow, with a 10px
 * radius off `deck`. Hover moves the border colour and nothing else: no lift,
 * no scale, no fill change.
 */
export function Panel({
  children,
  className = "",
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={`border border-console-rule bg-console ${
        interactive
          ? "deck-interactive hover:border-accent-bright"
          : "deck"
      } ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * Panel header strip: a mono label on its own rule-separated row.
 *
 * Wraps rather than compressing. A 0.14em-tracked label has no slack, so on a
 * narrow screen an unwrapped row broke the label mid-word ("TOP / UP") and ran
 * it under the aside; `shrink-0` plus a wrapping row keeps both intact.
 */
export function PanelHead({
  children,
  aside,
}: {
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-console-rule px-4 py-2.5">
      <span className="label-micro shrink-0 text-console-faint">{children}</span>
      {aside && <span className="ml-auto min-w-0">{aside}</span>}
    </div>
  );
}

/* ── Metrics ──────────────────────────────────────────────────────────── */

/**
 * Metric tiles. Was a hairline grid — one bordered block with the ground
 * bleeding through 1px gaps to draw its dividers. On the deck material the
 * cells separate into their own floating tiles, so the gap becomes real space
 * rather than a drawn line, and each number reads as its own object.
 */
export function StatStrip({
  children,
  cols = 4,
}: {
  children: ReactNode;
  cols?: 2 | 3 | 4;
}) {
  const lg =
    cols === 4 ? "lg:grid-cols-4" : cols === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2";
  return <dl className={`grid grid-cols-2 gap-2 ${lg}`}>{children}</dl>;
}

/** One tile of a StatStrip. `—` for an absent value, never a fabricated 0. */
export function Stat({
  label,
  value,
  accent = false,
  title,
}: {
  label: string;
  value: ReactNode;
  accent?: boolean;
  /** Hover explanation. A count whose 0 needs justifying should carry one. */
  title?: string;
}) {
  return (
    <div className="deck border border-console-rule bg-console px-4 py-3" title={title}>
      <dt className="label-micro text-console-faint">{label}</dt>
      <dd
        className={`mt-1 font-mono text-[17px] tabular-nums ${
          accent ? "text-accent-bright" : "text-console-ink"
        }`}
      >
        {value ?? "—"}
      </dd>
    </div>
  );
}

/**
 * Label-over-value cell for a card's meta strip. The canonical version of what
 * was four separate hand-rolled dt/dd pairs.
 */
export function Meta({
  label,
  children,
  title,
}: {
  label: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="label-micro text-console-faint">{label}</dt>
      <dd
        className="mt-0.5 truncate font-mono text-[12.5px] text-console-ink"
        title={title}
      >
        {children}
      </dd>
    </div>
  );
}

/** Baseline-aligned key/value row for a `divide-y` list inside a Panel. */
export function Row({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="label-micro shrink-0 text-console-faint">{label}</dt>
      <dd className="min-w-0 truncate font-mono text-[12.5px] tabular-nums text-console-ink">
        {children}
      </dd>
    </div>
  );
}

/* ── States ───────────────────────────────────────────────────────────── */

/**
 * Empty state. Solid rule border rather than the old dashed box: dashes read as
 * a drop target, and nothing here accepts one. Copy should state the fact and
 * the next step, so `action` is offered rather than implied.
 */
export function EmptyState({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="deck border border-console-rule bg-console px-4 py-6">
      <p className="font-mono text-[12.5px] leading-relaxed text-console-soft">
        {children}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Warning / error strip. `danger` and `warn-ink` both pass AA on this ground. */
export function Banner({
  children,
  tone = "warn",
}: {
  children: ReactNode;
  tone?: "warn" | "danger";
}) {
  const c =
    tone === "danger"
      ? "border-danger/40 bg-danger/5 text-danger"
      : "border-warn-ink/40 bg-warn/10 text-warn-ink";
  return (
    <div
      className={`deck flex items-center gap-2.5 border px-4 py-2.5 font-mono text-[12.5px] ${c}`}
    >
      {children}
    </div>
  );
}

/* ── Controls ─────────────────────────────────────────────────────────── */

/**
 * Small console action. One pill treatment for what had been six, and a 44px
 * minimum touch target — these sit in card headers where they used to be 26px.
 */
export function ActionButton({
  children,
  onClick,
  disabled,
  tone = "neutral",
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "neutral" | "danger";
  type?: "button" | "submit";
  title?: string;
}) {
  const c =
    tone === "danger"
      ? "border-danger/40 text-danger hover:border-danger"
      : "border-console-rule text-console-mid hover:border-accent-bright hover:text-accent-bright";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex min-h-11 items-center rounded-full border px-3.5 py-1.5 font-mono text-[12px] uppercase tracking-[0.1em] transition-colors disabled:opacity-40 md:min-h-0 ${c}`}
    >
      {children}
    </button>
  );
}

/** The primary console CTA — the marketplace's solid teal pill. */
export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={buttonClasses(
        "accent",
        "sm",
        "min-h-11 disabled:pointer-events-none disabled:opacity-40 md:min-h-0",
      )}
    >
      {children}
    </button>
  );
}

/** Status pill. Neutral by default; `accent` for a live/positive state. */
export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "danger";
}) {
  const c =
    tone === "accent"
      ? "bg-accent-soft text-accent"
      : tone === "danger"
        ? "border border-danger/40 text-danger"
        : "border border-console-rule text-console-soft";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[12px] ${c}`}
    >
      {children}
    </span>
  );
}
