"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The one-click deploy, shown as a friendly launch sequence: a progress rail
 * fills from step to step, each step checks itself off, then the panel flips
 * to "live" and loops. Plain language on purpose — this is for business
 * owners, not a terminal readout.
 */

const STEPS = [
  "Setting up your server",
  "Locking it down",
  "Connecting private memory",
  "Your agent is live",
];

const STEP_MS = 950; // dwell on each step
const HOLD_MS = 3200; // hold the finished state before looping

export function DeployLaunch() {
  // `active` is the step currently animating in; `done` is the highest index
  // already checked off. -1 means nothing done yet.
  const [active, setActive] = useState(0);
  const [done, setDone] = useState(-1);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduced.current) {
      setDone(STEPS.length - 1);
      setActive(STEPS.length);
    }
  }, []);

  useEffect(() => {
    if (reduced.current) return;
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const step = () => {
      if (cancelled) return;
      if (i >= STEPS.length) {
        setDone(STEPS.length - 1);
        setActive(STEPS.length);
        timer = setTimeout(() => {
          if (cancelled) return;
          setDone(-1);
          setActive(0);
          i = 0;
          timer = setTimeout(step, 600);
        }, HOLD_MS);
        return;
      }
      setActive(i);
      setDone(i - 1);
      i += 1;
      timer = setTimeout(step, STEP_MS);
    };

    step();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const finished = active >= STEPS.length;
  // The rail fills toward the step currently being worked on.
  const progress = finished
    ? 1
    : Math.max(0, active) / (STEPS.length - 1);

  return (
    <div className="border border-rule-strong bg-paper">
      <div className="flex items-center gap-2 border-b border-rule px-[18px] py-3 font-mono text-[12px] uppercase tracking-[0.14em]">
        <span
          className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
            finished ? "bg-signal" : "bg-accent animate-blink"
          }`}
        />
        <span className={finished ? "text-accent" : "text-ink-faint"}>
          {finished ? "Live" : "Deploying"}
        </span>
      </div>

      <div className="relative px-[18px] py-2">
        {/* progress rail: a hairline joins the step markers; the teal fill
            grows toward the step currently in progress */}
        <span
          aria-hidden="true"
          className="absolute left-[27.5px] top-[33px] bottom-[33px] w-px bg-rule"
        />
        <span
          aria-hidden="true"
          className="absolute left-[27.5px] top-[33px] bottom-[33px] w-px origin-top bg-accent transition-transform duration-700 ease-out"
          style={{ transform: `scaleY(${progress})` }}
        />
        {STEPS.map((label, i) => {
          const isDone = i <= done;
          const isActive = i === active && !isDone;
          return (
            <div key={label} className="relative flex items-center gap-3.5 py-[13px]">
              <span
                className={`grid h-5 w-5 flex-none place-items-center rounded-full border text-[11px] leading-none transition-[border-color,background-color,box-shadow,color] duration-300 ${
                  isDone
                    ? "border-accent bg-accent text-paper"
                    : isActive
                      ? "border-accent bg-paper text-transparent shadow-[0_0_0_4px_var(--color-accent-soft)]"
                      : "border-rule-strong bg-paper text-transparent"
                }`}
                aria-hidden="true"
              >
                ✓
              </span>
              <span
                className={`text-[15.5px] transition-colors duration-300 ${
                  isDone
                    ? "text-ink"
                    : isActive
                      ? "text-ink-body"
                      : "text-ink-faint"
                }`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 border-t border-rule bg-canvas px-[18px] py-3 font-mono text-[12px]">
        <span
          className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
            finished ? "bg-signal" : "bg-rule-strong"
          }`}
        />
        <span
          className={`transition-colors duration-300 ${
            finished ? "text-accent" : "text-ink-soft"
          }`}
        >
          Live in about 2 minutes
        </span>
      </div>
    </div>
  );
}
