"use client";

import { useEffect, useState } from "react";

/**
 * The stack headline, played as the agent's own loop: the active clause lights
 * up while the others rest, sweeping Hermes → Chromia → Atbash and back. It
 * reads as the agent stepping through its pipeline — act, record, judge.
 * Honours prefers-reduced-motion (all clauses shown lit, no cycling).
 */

const CLAUSES = [
  { lead: "Hermes", rest: " is the agent." },
  { lead: "Chromia", rest: " holds the record." },
  { lead: "Atbash", rest: " as the guardrail." },
];

export function AgentLine() {
  const [active, setActive] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    if (mq.matches) return;
    const id = setInterval(
      () => setActive((a) => (a + 1) % CLAUSES.length),
      1900,
    );
    return () => clearInterval(id);
  }, []);

  return (
    <>
      {CLAUSES.map((c, i) => {
        const on = reduced || i === active;
        return (
          <span
            key={c.lead}
            className={`transition-colors duration-700 ease-out ${
              on ? "text-ink" : "text-ink-faint"
            }`}
          >
            <span
              className={`transition-colors duration-700 ease-out ${
                on ? "text-accent" : "text-ink-faint"
              }`}
            >
              {c.lead}
            </span>
            {c.rest}
            {i < CLAUSES.length - 1 ? " " : ""}
          </span>
        );
      })}
    </>
  );
}
