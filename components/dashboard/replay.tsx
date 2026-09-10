"use client";

import { motion, type Transition } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  ActionButton,
  Banner,
  EmptyState,
  Panel,
  PanelHead,
} from "@/components/dashboard/ui";
import type { ReplayStep, SessionMeta } from "@/lib/dashboard/sessions";

const SPRING: Transition = { type: "spring", stiffness: 120, damping: 22 };

// Model output is markdown — render it (bold, code, lists, tables) styled to
// the theme rather than dumping raw `**`, fences and pipes as plain text.
const MD: Components = {
  p: ({ node, ...p }) => <p className="my-1.5 first:mt-0 last:mb-0" {...p} />,
  strong: ({ node, ...p }) => <strong className="font-medium text-console-ink" {...p} />,
  em: ({ node, ...p }) => <em className="italic" {...p} />,
  a: ({ node, ...p }) => (
    <a className="text-accent-bright underline underline-offset-2" target="_blank" rel="noreferrer" {...p} />
  ),
  ul: ({ node, ...p }) => <ul className="my-1.5 list-disc space-y-0.5 pl-5" {...p} />,
  ol: ({ node, ...p }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-5" {...p} />,
  li: ({ node, ...p }) => <li className="leading-relaxed" {...p} />,
  h1: ({ node, ...p }) => <h3 className="mb-1 mt-2 text-[15px] font-medium text-console-ink" {...p} />,
  h2: ({ node, ...p }) => <h3 className="mb-1 mt-2 text-[15px] font-medium text-console-ink" {...p} />,
  h3: ({ node, ...p }) => <h3 className="mb-1 mt-2 text-[14px] font-medium text-console-ink" {...p} />,
  blockquote: ({ node, ...p }) => (
    <blockquote className="my-1.5 border-l-2 border-console-rule pl-3 text-console-mid" {...p} />
  ),
  hr: () => <hr className="my-2 border-console-rule" />,
  code: ({ node, ...p }) => (
    <code
      className="border border-console-rule bg-console-deep px-1 py-px font-mono text-[12px] text-console-ink"
      {...p}
    />
  ),
  pre: ({ node, ...p }) => (
    <pre
      className="my-2 overflow-x-auto border border-console-rule bg-console-deep px-3 py-2 font-mono text-[12px] leading-relaxed text-console-ink [&>code]:!border-0 [&>code]:!bg-transparent [&>code]:!p-0 [&>code]:!text-inherit"
      {...p}
    />
  ),
  table: ({ node, ...p }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[13px]" {...p} />
    </div>
  ),
  th: ({ node, ...p }) => (
    <th className="label-micro border border-console-rule px-2 py-1.5 text-left text-console-faint" {...p} />
  ),
  td: ({ node, ...p }) => <td className="border border-console-rule px-2 py-1.5 align-top" {...p} />,
};

function Markdown({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <div
      className={`text-[14px] leading-relaxed break-words ${
        muted ? "text-console-mid" : "text-console-ink"
      }`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export function ReplayView() {
  const [sessions, setSessions] = useState<SessionMeta[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [steps, setSteps] = useState<ReplayStep[] | null>(null);
  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [loadingSteps, setLoadingSteps] = useState(false);
  const [errored, setErrored] = useState(false);

  const loadSessions = useCallback(() => {
    setErrored(false);
    setSessions(null);
    fetch("/api/replay", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { sessions?: SessionMeta[] }) => {
        const list = d.sessions ?? [];
        setSessions(list);
        if (list.length > 0) setSelected(list[0].file);
      })
      .catch(() => {
        // Distinguish a load failure from a genuinely empty machine.
        setErrored(true);
        setSessions([]);
      });
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const load = useCallback(async (file: string) => {
    setLoadingSteps(true);
    try {
      const d = await fetch(`/api/replay?file=${encodeURIComponent(file)}`, {
        cache: "no-store",
      }).then((r) => r.json());
      setSteps(d.steps ?? []);
      setMeta(d.meta ?? null);
    } finally {
      setLoadingSteps(false);
    }
  }, []);

  useEffect(() => {
    if (selected) load(selected);
  }, [selected, load]);

  if (!sessions) {
    return <EmptyState>loading conversations…</EmptyState>;
  }
  if (errored && sessions.length === 0) {
    return (
      <div className="space-y-3">
        <Banner tone="warn">
          Couldn&rsquo;t load conversations. The host may be unreachable.
        </Banner>
        <ActionButton onClick={loadSessions}>retry</ActionButton>
      </div>
    );
  }
  if (sessions.length === 0) {
    return (
      <EmptyState>no saved conversations on this machine yet.</EmptyState>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
      <SessionList
        sessions={sessions}
        selected={selected}
        onSelect={setSelected}
      />
      <Timeline meta={meta} steps={steps} loading={loadingSteps} />
    </div>
  );
}

// ─── Session picker ──────────────────────────────────────────

function SessionList({
  sessions,
  selected,
  onSelect,
}: {
  sessions: SessionMeta[];
  selected: string | null;
  onSelect: (file: string) => void;
}) {
  return (
    <Panel className="min-w-0">
      <PanelHead aside={`${sessions.length} on this machine`}>
        Conversations
      </PanelHead>
      <div className="max-h-[560px] overflow-auto">
        {sessions.map((s) => {
          const active = s.file === selected;
          return (
            <button
              key={s.file}
              type="button"
              onClick={() => onSelect(s.file)}
              className={`block min-h-11 w-full border-b border-console-rule px-4 py-3 text-left transition-colors last:border-0 ${
                active ? "bg-accent-soft" : "hover:bg-console-deep"
              }`}
            >
              <span className="block truncate text-[14px] text-console-ink">
                {s.title}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[12px] text-console-faint">
                <span className="text-console-mid">{s.platform}</span>
                <span>{prettyModel(s.model)}</span>
                <span className="tabular-nums">
                  {s.messages}m · {s.toolCalls}t
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

// ─── Step timeline ───────────────────────────────────────────

function Timeline({
  meta,
  steps,
  loading,
}: {
  meta: SessionMeta | null;
  steps: ReplayStep[] | null;
  loading: boolean;
}) {
  return (
    <Panel className="min-w-0">
      <PanelHead
        aside={
          meta
            ? `${prettyModel(meta.model)} · ${meta.platform} · ${
                steps?.filter((s) => s.kind === "action").length ?? 0
              } decisions`
            : undefined
        }
      >
        Step-by-step replay
      </PanelHead>
      <div className="px-4 py-4">
        {loading && !steps ? (
          <p className="font-mono text-[12.5px] text-console-faint">loading replay…</p>
        ) : !steps || steps.length === 0 ? (
          <p className="font-mono text-[12.5px] text-console-faint">no steps.</p>
        ) : (
          <ol className="space-y-3">
            {steps.map((s, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...SPRING, delay: Math.min(i * 0.015, 0.3) }}
              >
                <StepRow step={s} n={i + 1} />
              </motion.li>
            ))}
          </ol>
        )}
      </div>
    </Panel>
  );
}

function StepRow({ step, n }: { step: ReplayStep; n: number }) {
  if (step.kind === "user") {
    return (
      <Row n={n} tag="user" tagClass="text-console-mid">
        <Markdown text={step.text} />
      </Row>
    );
  }
  if (step.kind === "result") {
    return (
      <Row n={n} tag="result" tagClass="text-console-faint">
        <Disclosure label="output">
          <pre className="overflow-x-auto whitespace-pre-wrap border border-console-rule bg-console-deep px-3 py-2 font-mono text-[12px] leading-relaxed text-console-mid">
            {step.text || "—"}
          </pre>
        </Disclosure>
      </Row>
    );
  }
  if (step.kind === "reply") {
    return (
      <Row n={n} tag="agent" tagClass="text-accent-bright">
        {step.reasoning && <Reasoning text={step.reasoning} />}
        <Markdown text={step.text} />
      </Row>
    );
  }
  // action — the decision
  return (
    <Row n={n} tag="decision" tagClass="text-accent-bright" accent>
      {step.reasoning ? (
        <Reasoning text={step.reasoning} />
      ) : (
        <p className="mb-2 font-mono text-[12px] text-console-faint">
          (no recorded reasoning)
        </p>
      )}
      <div className="space-y-1.5">
        {step.tools.map((t, i) => (
          <div
            key={i}
            className="border border-console-rule bg-console-deep px-3 py-2 font-mono text-[12px]"
          >
            <span className="text-accent-bright">→ {t.name}</span>
            {t.args && (
              <span className="ml-2 break-all text-console-mid">{t.args}</span>
            )}
          </div>
        ))}
      </div>
    </Row>
  );
}

// Reasoning and raw tool output are the bulk of a transcript's noise — keep
// them one click away so the conversation flow reads cleanly by default.
function Disclosure({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="label-micro inline-flex min-h-11 items-center text-console-faint transition-colors hover:text-accent-bright md:min-h-0"
      >
        {open ? "▾" : "▸"} {label}
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

function Reasoning({ text }: { text: string }) {
  return (
    <div className="mb-2">
      <Disclosure label="reasoning">
        <div className="border-l-2 border-accent-bright/40 pl-3">
          <Markdown text={text} muted />
        </div>
      </Disclosure>
    </div>
  );
}

function Row({
  n,
  tag,
  tagClass,
  accent,
  children,
}: {
  n: number;
  tag: string;
  tagClass: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      {/* w-20: "decision" at the 12px micro-label size no longer fits w-14. */}
      <div className="flex w-20 shrink-0 flex-col items-end pt-0.5">
        <span className={`label-micro ${tagClass}`}>{tag}</span>
        <span className="mt-1 font-mono text-[12px] tabular-nums text-console-faint">
          {n}
        </span>
      </div>
      <div
        className={`min-w-0 flex-1 ${
          accent ? "border-l-2 border-accent-bright pl-3" : "border-l border-console-rule pl-3"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function prettyModel(model: string): string {
  const slug = model.includes("/") ? model.split("/")[1] : model;
  return slug.replace(/-preview$/, "");
}
