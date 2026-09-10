"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The headline, made literal: the agent's actions stream in one by one, each
 * resolving from "signing…" to a signed transaction with a tx hash. The trail
 * accumulates, holds, and loops — a record being written as the agent works.
 * Honours prefers-reduced-motion (whole trail shown, signed, no cycling).
 */

type Action = { act: string; arg: string; tx: string };

const TRAIL: Action[] = [
  { act: "read_file", arg: "agent/SOUL.md", tx: "3f9c…a1b2" },
  { act: "web.search", arg: "chromia ft4 auth", tx: "8b1e…d4a2" },
  { act: "patch", arg: "billing/route.ts", tx: "c50d…7e44" },
  { act: "terminal", arg: "npm run build", tx: "a3f1…4b90" },
  { act: "memory.store", arg: "ships sundays only", tx: "1d72…9f0c" },
  { act: "transfer", arg: "0.20 CHR → ops", tx: "e6a8…22bf" },
];

const SIGN_MS = 620; // head row spends this long "signing"
const GAP_MS = 520; // beat after a row signs before the next starts
const HOLD_MS = 3600; // hold the full trail before looping

export function AuditTrail() {
  // head = index currently being processed; phase = its state.
  const [head, setHead] = useState(0);
  const [phase, setPhase] = useState<"signing" | "done">("signing");
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduced.current) setHead(TRAIL.length);
  }, []);

  useEffect(() => {
    if (reduced.current) return;

    // Whole trail written — hold, then restart.
    if (head >= TRAIL.length) {
      const t = setTimeout(() => {
        setHead(0);
        setPhase("signing");
      }, HOLD_MS);
      return () => clearTimeout(t);
    }

    if (phase === "signing") {
      const t = setTimeout(() => setPhase("done"), SIGN_MS);
      return () => clearTimeout(t);
    }

    // Row signed — advance to the next after a beat.
    const t = setTimeout(() => {
      setHead((h) => h + 1);
      setPhase("signing");
    }, GAP_MS);
    return () => clearTimeout(t);
  }, [head, phase]);

  const signed = Math.min(head, TRAIL.length);

  return (
    <div className="border border-rule-strong bg-canvas">
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-rule text-[10px] uppercase tracking-[0.18em] text-ink-faint">
        <div className="flex items-center gap-2 font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-blink" />
          <span>audit trail</span>
        </div>
        <span className="font-mono tabular-nums">{signed} signed</span>
      </div>

      <ul className="px-5 py-4 min-h-[268px] space-y-2.5 font-mono text-[11.5px] leading-none">
        {TRAIL.map((row, i) => {
          // Render rows up to and including the head; later rows reserve no ink.
          if (i > head || i >= TRAIL.length) return null;
          const isHead = i === head;
          const signing = isHead && phase === "signing";
          return (
            <li
              key={row.tx}
              className="flex items-center gap-3 animate-reveal"
            >
              <span className="text-ink-faint tabular-nums shrink-0">
                {`#${String(i + 1).padStart(3, "0")}`}
              </span>
              <span className="text-ink shrink-0">{row.act}</span>
              <span className="text-ink-mid truncate">{row.arg}</span>
              <span className="ml-auto shrink-0 flex items-center gap-1.5">
                {signing ? (
                  <span className="flex items-center gap-1.5 text-ink-faint">
                    <span className="w-1 h-1 rounded-full bg-accent animate-blink" />
                    signing
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-accent">
                    <span aria-hidden>✓</span>
                    <span className="text-ink-faint">tx {row.tx}</span>
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
