"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Variants,
} from "framer-motion";

/**
 * The operator console, previewed. A dashboard frame whose sidebar tours
 * Deploy → Fleet → Analytics on its own and is fully clickable: picking a view
 * pins it and ends the tour. Plain-language mockups on purpose — this is for
 * business owners, so no keys, hex, or provider jargon.
 *
 * This section has no headline of its own; the panel's own heading changes with
 * the view, so the console explains itself as it moves.
 *
 * Motion is motivated, not decorative: the nav highlight slides between items
 * (continuity), the panel cross-fades and its rows settle in (a view swapped),
 * the bars grow from the axis (data arriving), and the hairline fills across the
 * top (the tour is advancing, so you know you can interrupt it). MotionConfig in
 * app/motion-provider.tsx honours prefers-reduced-motion; we additionally skip
 * the auto-tour so a reduced-motion visitor drives it by hand.
 */

type View = "deploy" | "fleet" | "analytics";

const VIEWS: { id: View; label: string }[] = [
  { id: "deploy", label: "Deploy" },
  { id: "fleet", label: "Fleet" },
  { id: "analytics", label: "Analytics" },
];

const DWELL_MS = 4200;
const EASE = [0.22, 1, 0.36, 1] as const;

const panelV: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.05 },
  },
  exit: { opacity: 0, transition: { duration: 0.16, ease: EASE } },
};

const rowV: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.36, ease: EASE } },
};

export function ConsolePreview() {
  const [active, setActive] = useState<View>("deploy");
  const [pinned, setPinned] = useState(false);
  const [inView, setInView] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const uid = useId();

  // Only tour while the frame is on screen — no offscreen timers.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), {
      threshold: 0.3,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const touring = inView && !pinned && !reduced;

  useEffect(() => {
    if (!touring) return;
    const id = setInterval(() => {
      setActive((cur) => {
        const i = VIEWS.findIndex((v) => v.id === cur);
        return VIEWS[(i + 1) % VIEWS.length].id;
      });
    }, DWELL_MS);
    return () => clearInterval(id);
  }, [touring]);

  // A manual pick ends the tour — the visitor is driving now.
  const pick = (v: View) => {
    setPinned(true);
    setActive(v);
  };

  return (
    <div
      ref={frameRef}
      className="relative border border-rule-strong bg-paper"
    >
      {/* Tour progress: fills across the dwell, so the swap never feels random. */}
      <AnimatePresence>
        {touring && (
          <motion.span
            key={active}
            aria-hidden
            className="absolute inset-x-0 top-0 z-10 h-px origin-left bg-accent"
            initial={{ scaleX: 0 }}
            // Per-state transitions: a shared `transition` prop would make the
            // exit fade inherit the 4.2s dwell and linger over the next bar.
            animate={{
              scaleX: 1,
              transition: { duration: DWELL_MS / 1000, ease: "linear" },
            }}
            exit={{ opacity: 0, transition: { duration: 0.2, ease: "linear" } }}
          />
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 md:grid-cols-[208px_1fr]">
        {/* sidebar — top strip on mobile, rail on desktop */}
        <div className="border-b border-rule bg-canvas-deep md:border-b-0 md:border-r">
          <div className="hidden px-5 py-5 md:block">
            <span className="font-sans text-[14px] font-medium tracking-tight text-ink">
              decenchro
            </span>
            <span className="mt-0.5 block font-mono text-[12px] uppercase tracking-[0.14em] text-ink-soft">
              agent console
            </span>
          </div>
          <div
            role="tablist"
            aria-label="Console preview"
            aria-orientation="vertical"
            className="grid grid-cols-3 gap-1 p-2 md:flex md:flex-col md:gap-0.5 md:px-2 md:pb-4"
          >
            {VIEWS.map((v) => {
              const on = active === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  role="tab"
                  id={`${uid}-tab-${v.id}`}
                  aria-selected={on}
                  aria-controls={`${uid}-panel-${v.id}`}
                  onClick={() => pick(v.id)}
                  className="group relative flex items-center justify-center gap-2 px-2 py-2.5 outline-none md:justify-start md:px-3 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-canvas-deep"
                >
                  {on && (
                    <motion.span
                      layoutId={`${uid}-nav`}
                      aria-hidden
                      className="absolute inset-0 bg-accent-soft"
                      transition={{
                        type: "spring",
                        stiffness: 420,
                        damping: 38,
                      }}
                    />
                  )}
                  <span
                    className={`relative z-[1] flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.12em] transition-colors ${
                      on
                        ? "text-ink"
                        : "text-ink-soft group-hover:text-ink-mid"
                    }`}
                  >
                    <ViewIcon id={v.id} className={on ? "text-accent" : ""} />
                    {v.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* panel */}
        <div className="min-h-[340px] p-5 sm:min-h-[368px] sm:p-7 md:p-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={active}
              role="tabpanel"
              id={`${uid}-panel-${active}`}
              aria-labelledby={`${uid}-tab-${active}`}
              variants={panelV}
              initial="hidden"
              animate="show"
              exit="exit"
            >
              {active === "deploy" && <DeployMock />}
              {active === "fleet" && <FleetMock />}
              {active === "analytics" && <AnalyticsMock />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/* ── panels ─────────────────────────────────────────────── */

function PanelHead({ title, sub }: { title: string; sub: string }) {
  return (
    <motion.div variants={rowV} className="mb-6">
      <h3 className="font-sans text-[19px] font-semibold tracking-[-0.012em] text-ink">
        {title}
      </h3>
      <p className="mt-1 text-[14px] leading-snug text-ink-mid">{sub}</p>
    </motion.div>
  );
}

function DeployMock() {
  return (
    <div className="max-w-[620px]">
      <PanelHead
        title="Deploy an agent"
        sub="Live on its own server in a couple of minutes."
      />
      <div className="space-y-3.5">
        <motion.div variants={rowV}>
          <MockField label="Agent name" value="support-agent" />
        </motion.div>
        <motion.div variants={rowV}>
          <MockField label="Model" value="GPT-5.4 mini" />
        </motion.div>
        <motion.div
          variants={rowV}
          className="flex items-center gap-2.5 border border-rule bg-canvas px-3.5 py-3"
        >
          <span className="grid h-4 w-4 flex-none place-items-center rounded-full bg-accent text-[9px] leading-none text-paper">
            ✓
          </span>
          <span className="text-[13.5px] text-ink-body">
            Private by default. Only you can talk to it.
          </span>
        </motion.div>
        <motion.div variants={rowV} className="pt-1">
          <span className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.12em] text-paper">
            Deploy
          </span>
        </motion.div>
      </div>
    </div>
  );
}

function MockField({
  label,
  value,
  select,
}: {
  label: string;
  value: string;
  select?: boolean;
}) {
  return (
    <div>
      <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-soft">
        {label}
      </span>
      <div className="mt-1.5 flex items-center justify-between border border-rule bg-canvas px-3.5 py-3">
        <span className="font-mono text-[13px] text-ink">{value}</span>
        {select && (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5 text-ink-soft"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        )}
      </div>
    </div>
  );
}

const FLEET = [
  { name: "support-agent", stat: "1,284 actions", state: "running" as const },
  { name: "sales-bot", stat: "642 actions", state: "running" as const },
  { name: "ops-helper", stat: "booting…", state: "booting" as const },
];

function FleetMock() {
  return (
    <div>
      <PanelHead title="Your fleet" sub="Every deployed agent and how it's doing." />
      <motion.div
        variants={rowV}
        className="mb-1 flex items-baseline justify-between border-b border-rule pb-2"
      >
        <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-accent">
          Agents
        </span>
        <span className="font-mono text-[12px] text-ink-soft">
          2 running · 1 booting
        </span>
      </motion.div>
      <ul className="divide-y divide-rule">
        {FLEET.map((a) => (
          <motion.li
            key={a.name}
            variants={rowV}
            className="flex items-center justify-between gap-4 py-3.5"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span
                className={`h-2 w-2 flex-none rounded-full ${
                  a.state === "running"
                    ? "bg-signal"
                    : "bg-accent motion-safe:animate-pulse"
                }`}
              />
              <span className="truncate font-mono text-[13.5px] text-ink">
                {a.name}
              </span>
            </span>
            <span
              className={`shrink-0 font-mono text-[12.5px] ${
                a.state === "booting" ? "text-ink-soft" : "text-ink-body"
              }`}
            >
              {a.stat}
            </span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

const KPIS = [
  { label: "Actions checked", value: "3,214" },
  { label: "Flagged for review", value: "12" },
  { label: "High-risk caught", value: "3" },
  { label: "Spend", value: "$18.40" },
];

// Messy, illustrative daily activity (mock) — grows in from the axis.
const BARS = [46, 62, 38, 74, 58, 88, 67];

const barV: Variants = {
  hidden: { scaleY: 0 },
  show: (i: number) => ({
    scaleY: 1,
    transition: { duration: 0.55, delay: i * 0.05, ease: EASE },
  }),
};

function AnalyticsMock() {
  return (
    <div>
      <PanelHead
        title="Analytics"
        sub="Usage, activity, and safety across the fleet."
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {KPIS.map((k) => (
          <motion.div
            key={k.label}
            variants={rowV}
            className="border border-rule bg-canvas px-3.5 py-3"
          >
            <p className="font-mono text-[12px] uppercase tracking-[0.1em] text-ink-soft">
              {k.label}
            </p>
            <p className="mt-1.5 font-sans text-[21px] font-medium tabular-nums tracking-tight text-ink">
              {k.value}
            </p>
          </motion.div>
        ))}
      </div>
      <motion.div
        variants={rowV}
        className="mt-4 border border-rule bg-canvas px-4 py-3.5"
      >
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-soft">
            Activity
          </span>
          <span className="font-mono text-[12px] text-ink-faint">
            last 7 days
          </span>
        </div>
        <div className="mt-3.5 flex h-20 items-end gap-2">
          {BARS.map((h, i) => (
            <motion.span
              key={i}
              custom={i}
              variants={barV}
              className="flex-1 origin-bottom bg-accent/70"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      </motion.div>
    </div>
  );
}

/* ── icons (match the real console's nav glyphs) ────────── */

function ViewIcon({ id, className }: { id: View; className?: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: `h-3.5 w-3.5 shrink-0 ${className ?? ""}`,
    "aria-hidden": true,
  };
  if (id === "deploy") {
    return (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="7" rx="1.5" />
        <rect x="3" y="13" width="18" height="7" rx="1.5" />
        <path d="M7 7.5h.01M7 16.5h.01" />
      </svg>
    );
  }
  if (id === "fleet") {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="8" height="8" rx="1.5" />
        <rect x="13" y="3" width="8" height="8" rx="1.5" />
        <rect x="3" y="13" width="8" height="8" rx="1.5" />
        <rect x="13" y="13" width="8" height="8" rx="1.5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}
