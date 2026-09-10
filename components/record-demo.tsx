"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The example record, played live: the store command types itself, the chain
 * answers with a transaction, then recall reads it back. Loops forever.
 */

type Line = { kind: "cmd" | "out" | "ok"; text: string };

const SCRIPT: Line[] = [
  {
    kind: "cmd",
    text: 'decenchro-mem store "user ships on Sundays only" --tags habit,pref',
  },
  {
    kind: "out",
    text: '{ "entryId": "a3f1…4b90", "txRid": "8b1e…d4a2" }',
  },
  { kind: "ok", text: "✓ signed & written to chromia" },
  {
    kind: "cmd",
    text: 'decenchro-mem search --query "when does the user ship?"',
  },
  { kind: "out", text: "→ ship on Sundays only · conf 94 · tags habit,pref" },
  { kind: "ok", text: "✓ recalled from chain · ranked by similarity" },
];

const TYPE_MS = 26; // per character
const OUT_MS = 550; // pause before an output line lands
const HOLD_MS = 4200; // hold the finished record before looping

export function RecordDemo() {
  // (line index, chars shown of that line) — output lines appear whole.
  const [pos, setPos] = useState<{ line: number; chars: number }>({
    line: 0,
    chars: 0,
  });
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduced.current) {
      setPos({ line: SCRIPT.length, chars: 0 });
    }
  }, []);

  useEffect(() => {
    if (reduced.current) return;

    // Finished — hold, then restart.
    if (pos.line >= SCRIPT.length) {
      const t = setTimeout(() => setPos({ line: 0, chars: 0 }), HOLD_MS);
      return () => clearTimeout(t);
    }

    const current = SCRIPT[pos.line];
    if (current.kind === "cmd" && pos.chars < current.text.length) {
      const t = setTimeout(
        () => setPos((p) => ({ ...p, chars: p.chars + 1 })),
        TYPE_MS,
      );
      return () => clearTimeout(t);
    }

    // Command fully typed, or an output line: advance after a beat.
    const t = setTimeout(
      () => setPos((p) => ({ line: p.line + 1, chars: 0 })),
      current.kind === "cmd" ? 350 : OUT_MS,
    );
    return () => clearTimeout(t);
  }, [pos]);

  return (
    <div className="border border-rule-strong bg-console text-console-ink font-mono text-[12.5px] leading-[1.75]">
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-console-rule text-[10px] uppercase tracking-[0.18em] text-console-faint">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-bright animate-blink" />
          <span>decenchro-mem</span>
        </div>
        <span>live record</span>
      </div>

      <div className="px-5 py-5 min-h-[230px] space-y-1.5 overflow-x-auto">
        {SCRIPT.map((line, i) => {
          if (i > pos.line) return null;
          const typing =
            i === pos.line &&
            line.kind === "cmd" &&
            pos.chars < line.text.length;
          const text =
            i === pos.line && line.kind === "cmd"
              ? line.text.slice(0, pos.chars)
              : line.text;
          // Output lines render only once the cursor has moved past them
          // being "current" — they land whole.
          if (i === pos.line && line.kind !== "cmd") return null;
          return (
            <div
              key={i}
              className={
                line.kind === "cmd"
                  ? "text-console-ink"
                  : line.kind === "ok"
                    ? "text-accent-bright animate-reveal"
                    : "text-console-mid animate-reveal"
              }
            >
              {line.kind === "cmd" && (
                <span className="text-accent-bright mr-2">$</span>
              )}
              {text}
              {typing && <span className="animate-caret">▍</span>}
            </div>
          );
        })}
        {/* idle prompt once the loop completes */}
        {pos.line >= SCRIPT.length && (
          <div>
            <span className="text-accent-bright mr-2">$</span>
            <span className="animate-caret">▍</span>
          </div>
        )}
      </div>
    </div>
  );
}
