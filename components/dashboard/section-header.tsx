"use client";

import type { ReactNode } from "react";

// Section header, in the marketplace's editorial shape: a mono kicker on a teal
// hairline, then the title, then one line of prose. Optional right-aligned slot
// for the section's primary action or live counts.
//
// Replaces the old display-type-plus-arrow-glyph header. Two deliberate
// differences from /agents' version: no leading 0N index (a console section is
// not one of an ordered set), and the rule sits above the header rather than
// under it, so a page reads as a stack of banded sections.
export function SectionHeader({
  kicker,
  title,
  description,
  aside,
}: {
  /** Mono micro-label above the title. Defaults to the title itself. */
  kicker?: string;
  title: string;
  // Optional: a section whose content already explains itself does not need a
  // line of prose above it repeating the same thing.
  description?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="min-w-0 max-w-[640px]">
        <div className="flex items-center gap-3">
          <span aria-hidden className="h-px w-7 shrink-0 bg-accent-bright" />
          <span className="label-micro text-accent-bright">{kicker ?? title}</span>
        </div>
        <h2 className="mt-2.5 text-[22px] font-medium leading-tight tracking-[-0.01em] text-console-ink">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-[16px] leading-relaxed text-console-mid">
            {description}
          </p>
        )}
      </div>
      {aside && <div className="shrink-0">{aside}</div>}
    </div>
  );
}

/**
 * Label above a panel — an h3 styled as a micro-label, the way the marketplace
 * titles its panels. Replaces three copy-pasted "subsection rail" divs.
 */
export function PanelLabel({
  children,
  aside,
  accent = false,
}: {
  children: ReactNode;
  aside?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h3
        className={`label-micro ${accent ? "text-accent-bright" : "text-console-faint"}`}
      >
        {children}
      </h3>
      {aside && (
        <span className="font-mono text-[12px] text-console-faint">{aside}</span>
      )}
    </div>
  );
}
