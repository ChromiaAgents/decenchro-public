"use client";

import { useEffect, useState } from "react";

type Entry = {
  id: number;
  kind: "STORE" | "RECALL" | "AUDIT";
  body: string;
  tags: string[];
  confidence: number | null;
  tx: string;
  ts: number;
};

const SEED: Omit<Entry, "id" | "ts">[] = [
  {
    kind: "STORE",
    body: "user prefers concise technical answers",
    tags: ["pref", "style"],
    confidence: 92,
    tx: "0x7f3a…b9e1",
  },
  {
    kind: "RECALL",
    body: 'query: tag="env" order by ts desc limit 3',
    tags: [],
    confidence: null,
    tx: "0x41d7…c08a",
  },
  {
    kind: "STORE",
    body: "corrected: api key lives in chain/client/.env",
    tags: ["fix", "env"],
    confidence: 98,
    tx: "0x2d8c…4f17",
  },
  {
    kind: "AUDIT",
    body: "verified 14 entries · namespace decen.agent/01",
    tags: [],
    confidence: null,
    tx: "0xa014…e2b2",
  },
  {
    kind: "STORE",
    body: "decision: ship telegram adapter before slack",
    tags: ["roadmap"],
    confidence: 86,
    tx: "0x9c55…71de",
  },
];

const EXTRA: Omit<Entry, "id" | "ts">[] = [
  {
    kind: "STORE",
    body: "learned: hermes prefers temperature 0.6 for code",
    tags: ["tune"],
    confidence: 88,
    tx: "0x4e12…a2b0",
  },
  {
    kind: "RECALL",
    body: 'query: confidence >= 90 skip 0 limit 5',
    tags: [],
    confidence: null,
    tx: "0x88a3…5fcc",
  },
  {
    kind: "STORE",
    body: "fact: user ships on sundays only",
    tags: ["pref", "habit"],
    confidence: 94,
    tx: "0x6701…3d42",
  },
];

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toISOString().slice(11, 19);
}

function kindColor(kind: Entry["kind"]) {
  switch (kind) {
    case "STORE":
      return "text-accent";
    case "RECALL":
      return "text-ink-mid";
    case "AUDIT":
      return "text-warn";
  }
}

const SEED_BASE_TS = 1736640000000; // deterministic for SSR parity

export function LiveMemoryLog() {
  const [entries, setEntries] = useState<Entry[]>(() =>
    SEED.map((e, i) => ({
      ...e,
      id: i,
      ts: SEED_BASE_TS + i * 2_400,
    })),
  );
  const [block, setBlock] = useState(412_889);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, []);

  useEffect(() => {
    let i = 0;
    const stream = setInterval(() => {
      const next = EXTRA[i % EXTRA.length];
      i += 1;
      setEntries((prev) => {
        const nextEntry: Entry = {
          ...next,
          id: (prev[prev.length - 1]?.id ?? 0) + 1,
          ts: Date.now(),
        };
        const updated = [...prev, nextEntry];
        return updated.slice(-5);
      });
      setBlock((b) => b + Math.floor(Math.random() * 3) + 1);
    }, 4200);
    return () => clearInterval(stream);
  }, []);

  return (
    <div className="relative crosshair bg-canvas-deep border border-rule-strong">
      {/* Header strip */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-rule">
        <div className="flex items-center gap-2.5">
          <span className="w-1.5 h-1.5 rounded-full bg-signal animate-blink" />
          <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-ink-mid">
            memory.stream
          </span>
        </div>
        <div className="font-mono text-[10px] tracking-[0.14em] text-ink-soft tabular-nums">
          blk {block.toLocaleString()}
        </div>
      </div>

      {/* Column labels */}
      <div className="grid grid-cols-[68px_60px_1fr] px-5 pt-4 pb-2 font-mono text-[9px] uppercase tracking-[0.2em] text-ink-faint">
        <span>time</span>
        <span>op</span>
        <span>payload</span>
      </div>

      {/* Entries */}
      <ul className="px-5 pb-4 flex flex-col">
        {entries.map((e, idx) => (
          <li
            key={e.id}
            className="grid grid-cols-[68px_60px_1fr] gap-x-2 py-2.5 border-t border-rule/70 font-mono text-[11.5px] leading-[1.5] animate-reveal"
            style={{ animationDelay: `${Math.min(idx, 4) * 50}ms` }}
          >
            <span className="text-ink-faint tabular-nums">
              {formatTime(e.ts)}
            </span>
            <span className={`${kindColor(e.kind)} font-medium`}>
              {e.kind}
            </span>
            <div className="min-w-0">
              <p className="text-ink truncate">{e.body}</p>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-faint">
                {e.tags.length > 0 && (
                  <span className="flex gap-1">
                    {e.tags.map((t) => (
                      <span
                        key={t}
                        className="px-1.5 py-[1px] bg-accent-soft text-accent tracking-wider"
                      >
                        {t}
                      </span>
                    ))}
                  </span>
                )}
                {e.confidence !== null && (
                  <span className="tabular-nums">
                    conf {e.confidence}
                  </span>
                )}
                <span className="ml-auto tabular-nums">{e.tx}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {/* Footer strip */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-rule font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft">
        <span>namespace · decen.agent/01</span>
        <span className="tabular-nums text-ink-mid">
          {now !== null ? formatTime(now) : "--:--:--"}
        </span>
      </div>
    </div>
  );
}
