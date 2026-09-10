"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { AgentAnalytics } from "@/components/dashboard/agent-analytics";
import {
  PostureMini,
  liveness,
  managedTone,
  provisioningLabel,
  relative,
  uptime,
} from "@/components/dashboard/agent-status";
import { CloudDeployment } from "@/components/dashboard/deploy";
import { FleetTable } from "@/components/dashboard/fleet-table";
import { GovernanceView } from "@/components/dashboard/governance";
import { ReplayView } from "@/components/dashboard/replay";
import {
  PanelLabel,
  SectionHeader,
} from "@/components/dashboard/section-header";
import {
  ActionButton,
  EmptyState,
  Meta,
  Panel,
  Pill,
  Stat,
  StatStrip,
} from "@/components/dashboard/ui";
import {
  POLL_ACTIVE_MS,
  POLL_IDLE_MS,
  refreshShared,
  usePoll,
  useSharedPoll,
} from "@/components/dashboard/use-poll";
import { Button } from "@/components/site/button";
import { agentCategory } from "@/lib/dashboard/agent-categories";
import type {
  AgentConfig,
  AgentConfigUpdate,
} from "@/lib/dashboard/agent-config";
// Type-only: agent-pairing is server-only, and `import type` is erased.
import type { PairingRequest } from "@/lib/dashboard/agent-pairing";
import type { Analytics } from "@/lib/dashboard/analytics";
import { provisionProgress } from "@/lib/dashboard/deploy-types";
import type { ManagedAgent } from "@/lib/dashboard/deployments";
import type { KeyPresence, ManagedKey } from "@/lib/dashboard/env-rw";
import type { FleetAgent } from "@/lib/dashboard/fleet";
import type { Identity } from "@/lib/dashboard/governance";
import type { LaunchStatus } from "@/lib/dashboard/hermes-control";
import type { PlanSummary } from "@/lib/dashboard/plan";
import { creditsUsdLabel } from "@/lib/dashboard/credits";
import {
  explorerAddressUrl,
  explorerTxUrl,
  scan8004AgentUrl,
  shortAddress,
} from "@/lib/erc8004-links";

// In-flight gateway operation. Each gets its own animation; a single boolean
// can't tell start from stop from restart (they used to share one).
type GatewayOp = "starting" | "stopping" | "restarting";

// Mirrors app/dashboard/layout.tsx: the console is cloud-only, so the overview is
// the deploy form rather than a local agent's live view.
const HOSTED = true;

type FieldSpec = {
  key: ManagedKey;
  label: string;
  placeholder: string;
  required: boolean;
};

const FIELDS: FieldSpec[] = [
  {
    key: "OPENROUTER_API_KEY",
    label: "OpenRouter",
    placeholder: "sk-or-…",
    required: true,
  },
  {
    key: "TELEGRAM_BOT_TOKEN",
    label: "Telegram bot",
    placeholder: "123456:ABC…",
    required: true,
  },
  {
    key: "ATBASH_AGENT_KEY",
    label: "Atbash key",
    placeholder: "0123…",
    required: true,
  },
];

// Overview / deploy form. Everything that used to be a sibling tab is its own
// route now, and the chrome (sidebar, session, company) moved to the layout — so
// authEnabled, session, company, initialTab and hosted are no longer props here.
export function DashboardClient({
  initialPresence,
  initialStatus,
  identity,
  canControl = false,
  initialHasAgents = false,
  initialBilling,
}: {
  initialPresence: KeyPresence;
  initialStatus: LaunchStatus;
  identity: Identity;
  canControl?: boolean;
  // Resolved on the server. Previously hardcoded false, which made the wizard
  // render its empty state on every load and then correct itself once /api/agents
  // answered.
  initialHasAgents?: boolean;
  initialBilling?: PlanSummary;
}) {
  const router = useRouter();
  // Sections are routes now, so what used to be component state is in the URL:
  // the drilled-into agent rides on /dashboard/atbash?agent=&fp=, and the reason
  // Plan was opened on /dashboard/billing?reason=deploy. Both survive a refresh
  // and can be linked to, which the old useState versions could not.
  const [presence, setPresence] = useState(initialPresence);
  const [status, setStatus] = useState(initialStatus);
  const [values, setValues] = useState<Partial<Record<ManagedKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [op, setOp] = useState<GatewayOp | null>(null);
  const [logTail, setLogTail] = useState("");
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);
  const [savingConfig, setSavingConfig] = useState<keyof AgentConfigUpdate | null>(null);
  const [configDirty, setConfigDirty] = useState(false);
  // Connectivity is reported by <HostContact /> in the shell now, so it warns on
  // every section rather than only on this one.
  const [message, setMessage] = useState<{
    tone: "ok" | "err";
    text: string;
  } | null>(null);

  // Live host state. Deliberately excludes the agent config, which only ever
  // changes through updateAgentConfig below — polling it was a third of the
  // console's request volume for a value that cannot move on its own.
  const refresh = useCallback(async () => {
    try {
      const [s, an] = await Promise.all([
        fetch("/api/launch", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/analytics", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (s?.status) setStatus(s.status);
      setLogTail(s?.log ?? "");
      if (an) setAnalytics(an);
    } catch {
      // A single miss can be a transient hiccup; only declare the host
      // unreachable after two in a row, then surface it instead of swallowing.
    }
  }, []);

  const updateAgentConfig = useCallback(
    async <K extends keyof AgentConfigUpdate>(
      field: K,
      value: NonNullable<AgentConfigUpdate[K]>,
    ) => {
      setSavingConfig(field);
      try {
        const res = await fetch("/api/agent-config", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ [field]: value }),
        });
        const data = await res.json();
        if (!res.ok) return;
        setAgentConfig(data.config);
        setConfigDirty(true);
      } finally {
        setSavingConfig(null);
      }
    },
    [],
  );

  // The config is read once, then kept current by the writes themselves.
  useEffect(() => {
    let alive = true;
    fetch("/api/agent-config", { cache: "no-store" })
      .then((r) => r.json())
      .then((ac) => {
        if (alive && ac?.config) setAgentConfig(ac.config);
      })
      .catch(() => {
        /* the config panel renders its empty state */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Tight while the operator is driving a start/stop/restart and watching the
  // status flip; relaxed the rest of the time. usePoll parks it entirely while
  // the tab is hidden and catches up on return.
  usePoll(refresh, op !== null ? POLL_ACTIVE_MS : POLL_IDLE_MS);

  // Save the filled fields, optionally narrowed to one step's keys. Only the
  // saved keys are cleared from the draft, so an in-progress step elsewhere
  // isn't wiped.
  const saveKeys = async (only?: ManagedKey[]) => {
    setSaving(true);
    setMessage(null);
    try {
      const body: Partial<Record<ManagedKey, string>> = {};
      for (const f of FIELDS) {
        if (only && !only.includes(f.key)) continue;
        const v = values[f.key];
        if (typeof v === "string" && v.trim().length > 0) body[f.key] = v.trim();
      }
      if (Object.keys(body).length === 0) {
        setMessage({ tone: "err", text: "nothing to save" });
        return;
      }
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ tone: "err", text: data.error ?? "save failed" });
        return;
      }
      setPresence(data.presence);
      setValues((s) => {
        const next = { ...s };
        for (const k of Object.keys(body)) delete next[k as ManagedKey];
        return next;
      });
      setMessage({ tone: "ok", text: "saved" });
    } finally {
      setSaving(false);
    }
  };

  const postLaunch = async (action: "start" | "stop") => {
    const res = await fetch("/api/launch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    return { ok: res.ok, data: await res.json() };
  };

  const reportError = (data: { error?: string; missing?: unknown }, fallback: string) => {
    const missing = Array.isArray(data.missing)
      ? ` (missing: ${data.missing.join(", ")})`
      : "";
    setMessage({ tone: "err", text: `${data.error ?? fallback}${missing}` });
  };

  // Hold the boot animation until Telegram actually connects (or 20s bail-out
  // so the UI doesn't get stuck if the bot token is wrong).
  const awaitTelegram = async () => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const an = await fetch("/api/analytics", { cache: "no-store" }).then((r) =>
        r.json(),
      );
      setAnalytics(an);
      if (an?.sessions?.telegram === "connected") break;
      await new Promise((r) => setTimeout(r, 800));
    }
  };

  const doLaunch = async (action: "start" | "stop") => {
    const began = Date.now();
    setOp(action === "start" ? "starting" : "stopping");
    setMessage(null);
    try {
      const { ok, data } = await postLaunch(action);
      if (!ok) {
        reportError(data, "failed");
        return;
      }
      setStatus(data.status);
      await refresh();
      if (action === "start") {
        await awaitTelegram();
      } else {
        // Stop is near-instant server-side; hold the shutdown animation long
        // enough to read (the four teardown steps take ~0.9s).
        const elapsed = Date.now() - began;
        if (elapsed < 1100) await new Promise((r) => setTimeout(r, 1100 - elapsed));
      }
    } finally {
      setOp(null);
    }
  };

  const doRestart = async () => {
    setOp("restarting");
    setMessage(null);
    try {
      await postLaunch("stop");
      await refresh();
      // a short beat so the teardown phase of the animation is legible
      await new Promise((r) => setTimeout(r, 700));
      const { ok, data } = await postLaunch("start");
      if (!ok) {
        reportError(data, "restart failed");
        return;
      }
      setStatus(data.status);
      await refresh();
      await awaitTelegram();
    } finally {
      setOp(null);
      setConfigDirty(false);
    }
  };

  const requiredMissing = FIELDS.filter(
    (f) => f.required && presence[f.key] !== "present",
  );
  const running = status.state === "running";

  return (
    <div className="animate-reveal">
      <AgentSurface
        identity={identity}
        presence={presence}
        values={values}
        onValueChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))}
        onSaveKeys={saveKeys}
        saving={saving}
        message={message}
        status={status}
        running={running}
        op={op}
        requiredMissing={requiredMissing.map((f) => f.key)}
        onLaunch={() => doLaunch("start")}
        onStop={async () => {
          await doLaunch("stop");
          setConfigDirty(false);
        }}
        onRestart={doRestart}
        logTail={logTail}
        analytics={analytics}
        agentConfig={agentConfig}
        savingConfig={savingConfig}
        onUpdateConfig={updateAgentConfig}
        configDirty={configDirty}
        canControl={canControl}
        hasAgents={initialHasAgents}
        hosted={HOSTED}
        canDeploy={Boolean(initialBilling?.canDeploy)}
        onInspectAgent={(a) =>
          router.push(
            `/dashboard/atbash?agent=${encodeURIComponent(a.pubkey)}&fp=${encodeURIComponent(a.fingerprint)}`,
          )
        }
        onGoFleet={() => router.push("/dashboard/fleet")}
        onNeedsBilling={() => router.push("/dashboard/billing?reason=deploy")}
      />
    </div>
  );
}

// Shows which agent the per-agent sections are narrowed to, with a one-tap
// escape back to the whole fleet.
export function ScopeBar({
  fingerprint,
  onClear,
}: {
  fingerprint: string;
  onClear: () => void;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border border-console-rule bg-console px-4 py-2.5">
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
        {/* Teal on the label alone: the scope is the one active filter on the
            page, and the panel itself stays neutral paper like every other. */}
        <span className="label-micro text-accent-bright">scoped to</span>
        <span className="truncate font-mono text-[12.5px] text-console-ink">
          {fingerprint}
        </span>
      </p>
      <ActionButton onClick={onClear}>whole fleet ✕</ActionButton>
    </div>
  );
}

// Atbash governance is not live yet — the Atbash-side functionality isn't ready,
// so the section shows "Coming soon". Flip this to false to restore the working
// Governance/Replay views below (their code is kept intact).
const ATBASH_COMING_SOON = true;

// Atbash is the runtime control layer — policy + live verdicts (Governance) and
// step-by-step session audit (Replay). One section, an inner toggle between them.
export function AtbashView({ scopedAgentPubkey }: { scopedAgentPubkey?: string }) {
  const [sub, setSub] = useState<"governance" | "replay">("governance");
  const subs: { id: typeof sub; label: string }[] = [
    { id: "governance", label: "Governance" },
    { id: "replay", label: "Replay" },
  ];
  return (
    <div className="space-y-6">
      <SectionHeader
        kicker="Runtime control"
        title="Atbash"
        description="Runtime policy and tool-call governance."
      />
      {ATBASH_COMING_SOON ? (
        <ComingSoon
          label="Governance & Replay"
          note="Runtime policy and tool-call auditing are on the way."
        />
      ) : (
        <>
          <div
            role="tablist"
            aria-label="Atbash views"
            className="flex flex-wrap items-center gap-2"
          >
            {subs.map((s) => {
              const active = sub === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSub(s.id)}
                  className={`min-h-11 rounded-full border px-3.5 py-1.5 font-mono text-[12px] uppercase tracking-[0.1em] transition-colors md:min-h-0 ${
                    active
                      ? "border-console-ink bg-console-ink text-console-deep"
                      : "border-console-rule text-console-soft hover:border-accent-bright hover:text-accent-bright"
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          {sub === "governance" ? (
            <GovernanceView scopedAgentPubkey={scopedAgentPubkey} />
          ) : (
            <ReplayView />
          )}
        </>
      )}
    </div>
  );
}

// Shared "coming soon" placeholder for features that aren't live yet. Left
// aligned like every other panel: a centred box read as a different material.
function ComingSoon({ label, note }: { label: string; note?: string }) {
  return (
    <Panel className="px-4 py-8 sm:px-6">
      <Pill tone="accent">Coming soon</Pill>
      <p className="mt-3 text-[15px] font-medium leading-snug text-console-ink">
        {label}
      </p>
      {note && (
        <p className="mt-1 text-[14px] leading-relaxed text-console-mid">{note}</p>
      )}
    </Panel>
  );
}

// ─── Fleet data ──────────────────────────────────────────────

// The on-chain fleet — the org's other agents. Reads through the shared poller,
// so it shares one request with any other surface watching /api/fleet.
function useFleetAgents(
  enabled: boolean,
  initial?: { agents?: FleetAgent[]; error?: string } | null,
): FleetAgent[] {
  const { data } = useSharedPoll<{ agents?: FleetAgent[]; error?: string }>(
    "/api/fleet",
    POLL_IDLE_MS,
    enabled,
    initial,
  );
  // An error body means the chain query failed — hold the last good roster
  // rather than blanking the fleet on a transient miss.
  const lastGood = useRef<FleetAgent[]>([]);
  return useMemo(() => {
    if (!enabled) lastGood.current = [];
    else if (data && !data.error && Array.isArray(data.agents))
      lastGood.current = data.agents;
    return lastGood.current;
  }, [data, enabled]);
}

// Cloud agents this company has provisioned through the console (the registry).
// These carry host + lifecycle metadata and are controllable, unlike bare
// on-chain fleet members. `manage` issues a power action and refreshes.
type ManageAction = "start" | "restart" | "delete" | "register";

// Lifecycle states worth watching closely — the roster polls faster while any
// agent sits in one of them.
const TRANSIENT_STATUS = ["pending", "provisioning", "starting", "stopping"];

function useManagedAgents(
  enabled: boolean,
  initial?: { agents?: ManagedAgent[] } | null,
): {
  agents: ManagedAgent[];
  manage: (id: string, action: ManageAction) => Promise<string | null>;
  refresh: () => void;
} {
  // Adaptive cadence: tight while any agent is mid-transition, relaxed once
  // everything is settled. `hot` is derived from the previous response, so the
  // interval tightens on the poll after a transition begins.
  const [hot, setHot] = useState(false);
  const { data } = useSharedPoll<{ agents?: ManagedAgent[] }>(
    "/api/agents",
    hot ? POLL_ACTIVE_MS : POLL_IDLE_MS,
    enabled,
    initial,
  );

  const lastGood = useRef<ManagedAgent[]>([]);
  const agents = useMemo(() => {
    if (!enabled) lastGood.current = [];
    else if (data && Array.isArray(data.agents)) lastGood.current = data.agents;
    return lastGood.current;
  }, [data, enabled]);

  useEffect(() => {
    setHot(agents.some((a) => TRANSIENT_STATUS.includes(a.status)));
  }, [agents]);

  const load = useCallback(() => refreshShared("/api/agents"), []);

  const manage = useCallback(
    async (id: string, action: ManageAction): Promise<string | null> => {
      try {
        const r = await fetch("/api/agents/manage", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ deploymentId: id, action }),
        });
        const j = await r.json().catch(() => ({}));
        await load();
        return r.ok ? null : (j.error ?? "action failed");
      } catch {
        return "could not reach the host";
      }
    },
    [load],
  );

  return { agents, manage, refresh: load };
}

// ─── Fleet cards ─────────────────────────────────────────────

// Telegram send/paper-plane glyph — signals the handle opens the chat.
// Mirrors DASHBOARD_USERNAME in lib/dashboard/agent-dashboard.ts, which is
// server-only and cannot be imported here. Fixed by design, and not a secret —
// duplicating the string beats shipping a server module to the browser.
const DASHBOARD_USER = "operator";

/**
 * One copyable credential. Reads as the value it copies ("operator",
 * "password") rather than as an instruction, so the pair lines up with the two
 * fields of the console's login form.
 */
function CopyChip({
  children,
  onCopy,
  done,
  busy = false,
  title,
}: {
  children: ReactNode;
  onCopy: () => Promise<unknown>;
  done: boolean;
  busy?: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      disabled={busy}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[12px] transition-colors disabled:opacity-50 ${
        done
          ? "border-accent-bright/40 text-accent-bright"
          : "border-console-rule text-console-mid hover:border-accent-bright/40 hover:text-accent-bright"
      }`}
    >
      {children}
      {/* The state lives in the icon, so the label never changes width and the
          row does not reflow on every copy. */}
      <span aria-hidden>{busy ? "…" : done ? "✓" : <CopyGlyph />}</span>
      <span className="sr-only">{done ? " copied" : " copy"}</span>
    </button>
  );
}

function CopyGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3 w-3 shrink-0"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </svg>
  );
}

/**
 * What is happening to an agent's on-chain identity before it has one.
 *
 * "registering…" on its own was the complaint: it is the same word whether the
 * mint is one block from landing, sitting in a queue until tomorrow's cron, or
 * not applicable at all. Every one of those is already distinguishable from the
 * row — a broadcast hash, a live agent with no hash, a dead one — so the state
 * gets named and the pending hash gets an explorer link.
 */
function Erc8004Pending({
  m,
  onRegister,
  busy,
}: {
  m: ManagedAgent;
  /** Admin-only. Absent for a viewer, who gets the state without the action. */
  onRegister?: () => void;
  busy: boolean;
}) {
  const live = m.status === "running" || m.status === "starting";

  if (m.erc8004Tx && m.erc8004ChainId != null) {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-console-mid">confirming</span>
        <a
          href={explorerTxUrl(m.erc8004ChainId, m.erc8004Tx)}
          target="_blank"
          rel="noreferrer"
          className="text-accent-bright transition-colors hover:underline"
          title="The register() transaction, on the block explorer"
        >
          tx ↗
        </a>
        <span className="text-console-faint">
          mint sent, waiting on the receipt
        </span>
      </span>
    );
  }

  if (m.status === "provisioning" || m.status === "pending") {
    return (
      <span className="text-console-faint">
        after the service is created
      </span>
    );
  }

  if (live) {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className="text-console-faint"
          title="The deploy-time attempt did not finish. /api/agents/attest retries it, but Vercel runs crons on production deployments only — outside production, this button is the retry."
        >
          not registered
        </span>
        {onRegister && (
          <button
            type="button"
            onClick={onRegister}
            disabled={busy}
            className="text-accent-bright transition-colors hover:underline disabled:opacity-50"
          >
            {busy ? "registering…" : "register now"}
          </button>
        )}
      </span>
    );
  }

  return (
    <span className="text-console-faint" title="registers on BNB Smart Chain after deploy">
      —
    </span>
  );
}

function ExternalGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3 w-3 shrink-0"
      aria-hidden="true"
    >
      <path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

function TelegramGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3 w-3 shrink-0"
      aria-hidden="true"
    >
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7z" />
    </svg>
  );
}

// One lifecycle control. Declared here rather than inside the card: it used to be
// a fresh function on every render, so React remounted the buttons on each poll
// tick and a press could land on a different element than the one aimed at.
function ManageButton({
  action,
  label,
  busy,
  onAct,
}: {
  action: ManageAction;
  label: string;
  busy: ManageAction | null;
  onAct: (action: ManageAction) => void;
}) {
  return (
    <ActionButton
      tone={action === "delete" ? "danger" : "neutral"}
      disabled={busy !== null}
      onClick={() => onAct(action)}
    >
      {busy === action ? "…" : label}
    </ActionButton>
  );
}

// Status → pill tone. Only running earns the accent; a failed box is the one
// state that should read as an error.
function statusTone(status: ManagedAgent["status"]): "neutral" | "accent" | "danger" {
  if (status === "running") return "accent";
  if (status === "failed") return "danger";
  return "neutral";
}

// A provisioned cloud agent: host + status + lifecycle controls, optionally
// enriched with on-chain stats once it has signed its first action.
/** "4m ago" / "2h ago" — how long a sender has been waiting to be let in. */
function formatAge(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function ManagedAgentCard({
  m,
  canControl,
  onManage,
  onInspect,
}: {
  m: ManagedAgent;
  canControl: boolean;
  onManage: (id: string, action: ManageAction) => Promise<string | null>;
  onInspect: (a: { pubkey: string; fingerprint: string }) => void;
}) {
  const [busy, setBusy] = useState<ManageAction | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // The bot's @handle for the Telegram deep-link. undefined = still checking,
  // null = none/not-yet-reachable, string = the handle.
  const [botUser, setBotUser] = useState<string | null | undefined>(undefined);
  // Agent console LOGIN. The url rides on the row (m.dashboardUrl) because it is
  // not a secret; only the password costs a request, and only on click — it must
  // never ride along on the roster poll, and it is never rendered: a blocked
  // clipboard reports an error instead of printing the credential to a screen
  // that is often shared.
  const [loadingHermes, setLoadingHermes] = useState(false);
  // Which field was just copied. The console login form has two, so a single
  // boolean could not say which chip had fired.
  const [copied, setCopied] = useState<"user" | "password" | null>(null);
  const tone = managedTone(m.status);
  const provisioning = m.status === "provisioning" || m.status === "pending";
  // Age of the deployment, ticked while it boots so the first step's bar creeps
  // instead of holding one value for the whole image pull. Starts at 0 rather
  // than Date.now(): this card server-renders, and seeding from the clock would
  // hydrate a different width than the server painted.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!provisioning) return;
    const started = Date.parse(m.createdAt);
    if (!Number.isFinite(started)) return;
    const tick = () => setElapsed(Date.now() - started);
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [provisioning, m.createdAt]);
  const progress = provisionProgress(m.provisionPhase, elapsed);
  // Power transition in flight — reconcile-on-read will settle it; no controls
  // until it does (matches EC2: no actions while stopping/starting).
  const transitioning = m.status === "starting" || m.status === "stopping";

  // Resolve the Telegram bot handle once the box is up (skip while provisioning
  // or deleted). The endpoint caches server-side, so this is a one-shot per card.
  useEffect(() => {
    if (m.status === "deleted" || provisioning) {
      setBotUser(null);
      return;
    }
    let alive = true;
    fetch(`/api/agents/telegram?id=${m.id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => alive && setBotUser(j.username ?? null))
      .catch(() => alive && setBotUser(null));
    return () => {
      alive = false;
    };
  }, [m.id, m.status, provisioning]);

  // Senders waiting for approval. Hermes hands an unknown sender a code and
  // tells them to run `hermes pairing approve …` on the box, which a Render
  // tenant cannot do, so without this the second person to message an agent is
  // stuck forever. undefined = still asking, [] = nobody waiting.
  const [pending, setPending] = useState<PairingRequest[] | undefined>(undefined);
  const [approving, setApproving] = useState<string | null>(null);

  const loadPending = useCallback(async () => {
    if (m.status === "deleted" || provisioning) {
      setPending([]);
      return;
    }
    try {
      const r = await fetch(`/api/agents/pairing?id=${m.id}`, { cache: "no-store" });
      const j = await r.json();
      setPending(Array.isArray(j.pending) ? j.pending : []);
    } catch {
      // An unreachable agent is not an error worth a red line here: the card
      // already shows its status. Just claim nobody is waiting.
      setPending([]);
    }
  }, [m.id, m.status, provisioning]);

  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  const approve = async (req: PairingRequest) => {
    setErr(null);
    setApproving(req.requestId);
    try {
      const r = await fetch("/api/agents/pairing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deploymentId: m.id,
          platform: req.platform,
          requestId: req.requestId,
        }),
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErr(j.error ?? "could not approve");
      // Re-read either way: on success the row is gone, on failure it may have
      // expired underneath us and the list is the truth.
      await loadPending();
    } catch {
      setErr("could not reach the agent");
    } finally {
      setApproving(null);
    }
  };

  /** Copy one field and flag which chip did it. Returns false if blocked. */
  const copyField = async (
    field: "user" | "password",
    value: string,
  ): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(field);
      window.setTimeout(
        () => setCopied((c) => (c === field ? null : c)),
        2500,
      );
      return true;
    } catch {
      return false;
    }
  };

  // The console asks for a username AND a password, so both are one click. The
  // username is a fixed non-secret, so it copies with no request at all; only
  // the password costs a POST, and it is copied, never printed — an operator's
  // screen is often shared, and a 32-char hex string is pasted, not read. A
  // blocked clipboard says so; the password can still be read from the agent's
  // own console session, so there is no need to put it on screen here.
  const copyPasswordFromApi = async () => {
    setLoadingHermes(true);
    setErr(null);
    try {
      const r = await fetch("/api/agents/dashboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deploymentId: m.id }),
        cache: "no-store",
      });
      const j = await r.json();
      if (!r.ok || !j.password) {
        setErr(j.error ?? "no console login for this agent");
        return;
      }
      if (!(await copyField("password", j.password)))
        setErr("clipboard blocked by the browser — allow it for this site and copy again");
    } catch {
      setErr("could not reach the console");
    } finally {
      setLoadingHermes(false);
    }
  };

  const act = async (action: ManageAction) => {
    if (action === "delete" && !window.confirm("Remove this agent? The server is destroyed and this cannot be undone."))
      return;
    // Spends gas from the platform wallet and mints an NFT, so it asks first.
    if (
      action === "register" &&
      !window.confirm(
        "Register this agent's on-chain identity now? This sends a transaction on BNB Smart Chain.",
      )
    )
      return;
    setErr(null);
    setBusy(action);
    const e = await onManage(m.id, action);
    setBusy(null);
    if (e) setErr(e);
  };



  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3">
        <button
          type="button"
          onClick={() => onInspect({ pubkey: m.pubkey, fingerprint: m.fingerprint })}
          className="group flex min-w-0 items-center gap-2.5 text-left"
        >
          <span className={`inline-flex h-2 w-2 shrink-0 rounded-full ${tone.dot}`} title={tone.label} />
          <span className="truncate text-[15px] font-medium leading-snug text-console-ink transition-colors group-hover:text-accent-bright">
            {m.agentName}
          </span>
          <Pill tone={statusTone(m.status)}>{tone.label}</Pill>
        </button>
        {canControl && !provisioning && !transitioning && m.status !== "deleted" && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {/* No stop: an agent is running or removed. Start appears only to
                resume one the platform paused at a zero balance. */}
            {m.status === "stopped" && (
              <ManageButton action="start" label="resume" busy={busy} onAct={act} />
            )}
            <ManageButton action="restart" label="restart" busy={busy} onAct={act} />
            <ManageButton action="delete" label="remove" busy={busy} onAct={act} />
          </div>
        )}
      </div>

      {/* Two rows of three at desktop rather than one wrapping flex line: the
          values are wildly different widths, so a flex row left ragged gaps and
          dropped "Created on" onto its own line at the wrong breakpoints. */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-console-rule px-4 py-3 sm:grid-cols-3">
        <Meta label="Telegram">
          {botUser ? (
            <a
              // ?start=claim, not a bare handle: Telegram turns a /start payload
              // into a real message, so tapping this IS the pairing step. A bare
              // link only opened a chat and left the operator wondering what to
              // type — and until someone types, the agent has no owner and
              // answers nobody.
              href={`https://t.me/${botUser}?start=claim`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-accent-bright transition-colors hover:underline"
              title={`Open in Telegram. The first message pairs you as this agent's owner; send a second one to get a reply.`}
            >
              <TelegramGlyph />@{botUser}
            </a>
          ) : botUser === undefined ? (
            <span className="text-console-faint">checking…</span>
          ) : (
            <span className="text-console-faint">—</span>
          )}
        </Meta>
        <Meta label="Agent console">
          {/* The link is here on first paint — the url is on the row, so there
              is nothing to click before you can see it. Then one chip per field
              the login form asks for: the console wants a username AND a
              password, and copying only the password left the operator typing
              the other half by hand. */}
          {m.dashboardUrl && !provisioning && m.status !== "deleted" ? (
            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <a
                href={m.dashboardUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-accent-bright transition-colors hover:underline"
                title="Open this agent's console"
              >
                open
                <ExternalGlyph />
              </a>
              <span aria-hidden className="text-console-rule">
                |
              </span>
              {/* Both chips name their FIELD, not their value — one showing
                  "operator" next to one showing "password" read as two different
                  kinds of thing. The value is a hover away, and copying is what
                  the chip is for. No request for this one: the username is fixed
                  and is not a secret. */}
              <CopyChip
                onCopy={() => copyField("user", DASHBOARD_USER)}
                done={copied === "user"}
                title={`Copy the username (${DASHBOARD_USER})`}
              >
                username
              </CopyChip>
              <CopyChip
                onCopy={copyPasswordFromApi}
                done={copied === "password"}
                busy={loadingHermes}
                title={`Copy the password for ${DASHBOARD_USER}`}
              >
                password
              </CopyChip>
            </span>
          ) : (
            <span
              className="text-console-faint"
              title={
                m.dashboardUrl
                  ? "available once the agent is running"
                  : "only agents on Render expose one"
              }
            >
              —
            </span>
          )}
        </Meta>
        <Meta label="Type">
          {/* Fixed at deploy, so this always matches the SOUL.md the box booted
              with. Agents created before categories existed read as General. */}
          <span className="text-console-ink">{agentCategory(m.categoryId).label}</span>
        </Meta>
        <Meta label="Created on">
          <span className="text-console-ink">
            {new Date(m.createdAt).toLocaleString("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </span>
        </Meta>
        {/* Shortened for the row; the full uuid is in the tooltip so it can
            still be read off when referencing this agent. */}
        <Meta label="Agent ID" title={m.id}>
          <span className="text-console-ink">
            {m.id.slice(0, 8)}…{m.id.slice(-4)}
          </span>
        </Meta>
        <Meta label="ERC-8004">
          {m.erc8004AgentId != null && m.erc8004ChainId != null ? (
            <span className="inline-flex items-center gap-2">
              <a
                href={`/agents/${m.erc8004ChainId}/${m.erc8004AgentId}`}
                target="_blank"
                rel="noreferrer"
                className="text-accent-bright transition-colors hover:underline"
                title={`Agent #${m.erc8004AgentId}: view marketplace listing`}
              >
                #{m.erc8004AgentId}
              </a>
              <a
                href={scan8004AgentUrl(m.erc8004ChainId, m.erc8004AgentId)}
                target="_blank"
                rel="noreferrer"
                className="text-console-mid transition-colors hover:text-accent-bright hover:underline"
                title="8004scan"
              >
                scan
              </a>
              {m.bscAddress && (
                <a
                  href={explorerAddressUrl(m.erc8004ChainId, m.bscAddress)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-console-mid transition-colors hover:text-accent-bright hover:underline"
                  title={m.bscAddress}
                >
                  {shortAddress(m.bscAddress)}
                </a>
              )}
            </span>
          ) : (
            <Erc8004Pending
              m={m}
              busy={busy === "register"}
              onRegister={
                canControl ? () => void act("register") : undefined
              }
            />
          )}
        </Meta>
        {/* Both of these were already in the payload and shown nowhere: the card
            could say when an agent was created but never how long it had been
            up, and the console could show a company balance but never what one
            agent had cost. */}
        <Meta
          label="Uptime"
          title="How long this agent has been running. Counts from when it reported ready, so provisioning and any time it spent paused are excluded. A dash means it is still provisioning, or never came up."
        >
          <span className="text-console-ink">{uptime(m)}</span>
        </Meta>
        {/* The deploy wait, which is the figure the slimmed image moved and the
            one an operator remembers. Live while provisioning, then frozen at
            what it actually took. */}
        <Meta
          label={provisioning ? "Provisioning" : "Provisioned in"}
          title="Time from pressing Deploy to the agent answering its own health check: Render creating the service, pulling the image, booting the container. Typically about 75 seconds. A dash means the agent never reported ready."
        >
          <span className="text-console-ink">{provisioningLabel(m)}</span>
        </Meta>
        <Meta
          label="Spent"
          title="Billed against this agent, in the same dollars as your balance: runtime plus the model at a 1.2x markup. Model cost below is the provider's raw USD instead, so the two never match."
        >
          {m.creditsSpent != null ? (
            <span className="text-console-ink">
              {creditsUsdLabel(m.creditsSpent)}
              {/* The split, because one total next to the usage strip's raw
                  provider cost reads as two numbers disagreeing. */}
              {m.creditsSpentSplit && m.creditsSpent > 0 && (
                <span className="text-console-faint">
                  {" "}
                  · {creditsUsdLabel(m.creditsSpentSplit.runtime)} runtime +{" "}
                  {creditsUsdLabel(m.creditsSpentSplit.model)} model
                </span>
              )}
            </span>
          ) : (
            <span className="text-console-faint">—</span>
          )}
        </Meta>
      </dl>

      {/* Live usage, read from this agent's own host. This was a whole section
          of its own (/dashboard/analytics) listing the same roster as Fleet, so
          answering "what has this agent been doing?" meant holding two lists in
          your head. It is the tail of the card now: the agent, then its work. */}
      <AgentAnalytics
        deploymentId={m.id}
        canControl={canControl}
        provisioning={provisioning}
        deleted={m.status === "deleted"}
      />

      {/* Waiting senders. Hidden entirely when nobody is waiting — this is an
          exception queue, not a permanent panel. */}
      {pending && pending.length > 0 && (
        <div className="border-t border-console-rule px-4 py-3">
          <p className="label-micro text-console-faint">
            Waiting to be let in ({pending.length})
          </p>
          <p className="mt-1.5 font-mono text-[12px] leading-relaxed text-console-faint">
            These people messaged the agent and it did not recognise them.
            Approving one lets them use the agent and spend this
            company&apos;s credits.
          </p>
          <ul className="mt-2.5 space-y-2">
            {pending.map((req) => (
              <li
                key={req.requestId}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2"
              >
                <span className="min-w-0 font-mono text-[12.5px] text-console-ink">
                  <span className="text-console-faint">{req.platform}</span>{" "}
                  <span className="break-all">{req.userName}</span>
                  {req.ageMinutes > 0 && (
                    <span className="text-console-faint">
                      {" "}
                      · {formatAge(req.ageMinutes)}
                    </span>
                  )}
                </span>
                {canControl && (
                  <ActionButton
                    onClick={() => void approve(req)}
                    disabled={approving !== null}
                  >
                    {approving === req.requestId ? "…" : "approve"}
                  </ActionButton>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Granular launch progress (EC2-style status detail): survives refresh
          because it renders straight from the registry's provision_phase. What
          is happening, not "step N/7" — the phases are minutes then seconds, so
          the count told the operator nothing about the wait. */}
      {provisioning && (
        <div className="border-t border-console-rule px-4 py-3">
          <p className="font-mono text-[12.5px] text-console-mid">
            {progress.label}…
          </p>
          {/* 500ms ticks under a 600ms transition, so the fill reads as one
              continuous crawl rather than a series of steps. */}
          <div
            className="mt-2.5 h-1 overflow-hidden bg-console-rule"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress.frac * 100)}
            aria-label={progress.label}
          >
            <div
              className="h-full bg-accent-bright transition-[width] duration-600 ease-linear"
              style={{ width: `${progress.frac * 100}%` }}
            />
          </div>
          <p className="mt-2 font-mono text-[12px] leading-relaxed text-console-faint">
            {progress.detail}
          </p>
        </div>
      )}

      {(err || m.failReason) && (
        <p className="border-t border-console-rule px-4 py-2.5 font-mono text-[12.5px] text-danger">
          {err ?? m.failReason}
        </p>
      )}
    </Panel>
  );
}

// A remote agent in the fleet — read-only. It runs on another host, so there
// are no live controls here; the card mirrors the managed agent's shape (header
// + meta strip) and links into the per-agent Atbash view.
function FleetMemberCard({
  a,
  onInspect,
}: {
  a: FleetAgent;
  onInspect: (a: { pubkey: string; fingerprint: string }) => void;
}) {
  const s = liveness(a.lastActive);
  const topTool = a.topTools[0];
  return (
    // focus-within, not just hover: the whole card is one button, and a keyboard
    // operator gets no border feedback from the hover rule alone.
    <Panel interactive className="focus-within:border-accent-bright">
      <button
        type="button"
        onClick={() => onInspect({ pubkey: a.pubkey, fingerprint: a.fingerprint })}
        className="group block w-full text-left"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={`inline-flex h-2 w-2 shrink-0 rounded-full ${s.dot}`}
              title={s.label}
            />
            <span className="label-micro shrink-0 text-console-faint">agent</span>
            <span className="truncate font-mono text-[12.5px] text-console-ink transition-colors group-hover:text-accent-bright">
              {a.fingerprint}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {a.heldPending > 0 && (
              <span className="font-mono text-[12px] tabular-nums text-warn-ink">
                {a.heldPending} held
              </span>
            )}
            <span className="label-micro text-console-faint">view only</span>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-console-rule px-4 py-3 sm:grid-cols-4">
          <Meta label="Actions">{a.actions.toLocaleString()}</Meta>
          <Meta label="Safety">
            <PostureMini v={a.verdicts} />
          </Meta>
          <Meta label="Top tool">
            {topTool ? `${topTool.name} · ${topTool.count}` : "—"}
          </Meta>
          <Meta label="Last active">{relative(a.lastActive)}</Meta>
        </dl>
      </button>
    </Panel>
  );
}

// ─── Deploy surface ──────────────────────────────────────────

type SurfaceProps = {
  identity: Identity;
  presence: KeyPresence;
  values: Partial<Record<ManagedKey, string>>;
  onValueChange: (k: ManagedKey, v: string) => void;
  onSaveKeys: (only?: ManagedKey[]) => void;
  saving: boolean;
  message: { tone: "ok" | "err"; text: string } | null;
  status: LaunchStatus;
  running: boolean;
  op: GatewayOp | null;
  requiredMissing: ManagedKey[];
  onLaunch: () => void;
  onStop: () => void;
  onRestart: () => void;
  logTail: string;
  analytics: Analytics | null;
  agentConfig: AgentConfig | null;
  savingConfig: keyof AgentConfigUpdate | null;
  onUpdateConfig: <K extends keyof AgentConfigUpdate>(
    field: K,
    value: NonNullable<AgentConfigUpdate[K]>,
  ) => Promise<void>;
  configDirty: boolean;
  canControl: boolean;
  hasAgents: boolean;
  hosted: boolean;
  canDeploy: boolean;
  onInspectAgent: (a: { pubkey: string; fingerprint: string }) => void;
  // Jump to the Fleet section — where deployed agents are operated.
  onGoFleet: () => void;
  // Jump to the Credits section when a Deploy click hits a company with no
  // credits.
  onNeedsBilling: () => void;
};

/**
 * The console is cloud-only (HOSTED), so this surface has exactly one job: the
 * deploy form. There is no local gateway to go "live" on, and the old
 * Identity/Keys wizard could not save anything on a hosted host anyway —
 * everything a deploy needs (name, Atbash key, Telegram token) is on the form.
 *
 * The plan gate is deliberately deferred: the form always shows, and only on
 * Deploy does an unfunded company get routed to Credits by the 402.
 *
 * The live-host props above are still passed in full. DashboardClient keeps
 * polling /api/launch and /api/analytics, and trimming the bag to what this
 * renders would quietly drop those polls with it.
 */
function AgentSurface({
  presence,
  values,
  hosted,
  canDeploy,
  onGoFleet,
  onNeedsBilling,
}: SurfaceProps) {
  // Bumped to remount the form: fresh state after a failed deploy's "back to
  // setup", and after a submit so the form is clear for the next one.
  const [formNonce, setFormNonce] = useState(0);

  return (
    <CloudDeployment
      key={formNonce}
      onBack={() => setFormNonce((n) => n + 1)}
      onSubmitted={() => {
        setFormNonce((n) => n + 1);
        // Provisioning kicked off — watch it on Fleet, and leave the form ready
        // for the next deploy.
        onGoFleet();
      }}
      onNeedsBilling={onNeedsBilling}
      canDeploy={canDeploy}
      standalone={hosted}
      initial={{
        telegramBotToken: values.TELEGRAM_BOT_TOKEN,
      }}
      saved={{
        telegram: presence.TELEGRAM_BOT_TOKEN === "present",
      }}
    />
  );
}

// ─── Fleet section ───────────────────────────────────────────

// Dedicated, always-reachable roster of every deployed agent and its live
// state — the answer to "what's deployed and what is it doing?". Managed cloud
// agents come from the registry with lifecycle controls; bare on-chain agents
// are view-only.
export function FleetTabView({
  canControl,
  onInspectAgent,
  initialManaged,
  initialFleet,
}: {
  canControl: boolean;
  onInspectAgent: (a: { pubkey: string; fingerprint: string }) => void;
  // Rendered on the server by app/dashboard/fleet/page.tsx, so the roster is
  // present in the first paint. Both are optional: the component still works
  // client-only, it just starts empty.
  initialManaged?: { agents?: ManagedAgent[] } | null;
  initialFleet?: { agents?: FleetAgent[]; error?: string } | null;
}) {
  const fleetAgents = useFleetAgents(true, initialFleet);
  const { agents: managedAgents, manage } = useManagedAgents(true, initialManaged);

  // Managed agents are explicit cloud deployments from the registry; the
  // on-chain roster below adds any signer that isn't one of them.
  const managedRemote = managedAgents;
  const managedPubs = new Set(managedRemote.map((m) => m.pubkey.toLowerCase()));
  const onChainOnly = fleetAgents.filter(
    (a) => !managedPubs.has(a.pubkey.toLowerCase()),
  );
  const total = managedRemote.length + onChainOnly.length;
  // Registered on BNB Smart Chain — read off the managed rows, which already
  // carry the id. The Chromia signer count answers a different question and the
  // two are not interchangeable.
  const registeredCount = managedRemote.filter(
    (m) => m.erc8004AgentId != null,
  ).length;

  // At-a-glance state summary, EC2 instances-page style.
  const counts = new Map<string, number>();
  for (const m of managedRemote) {
    const label = managedTone(m.status).label;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const summary = [...counts.entries()]
    .map(([label, n]) => `${n} ${label}`)
    .join(" · ");

  const runningCount = managedRemote.filter((m) => m.status === "running").length;
  const provisioningCount = managedRemote.filter(
    (m) => m.status === "provisioning" || m.status === "pending",
  ).length;

  return (
    <div className="space-y-6">
      <SectionHeader
        kicker="Deployed agents"
        title="Fleet"
        description="Every deployed agent, its live state and what it has been doing."
      />

      {/* Only counts that come off the two rosters already in scope.
          Two DIFFERENT chains are involved and one label used to cover both:
          "On-chain identities" counted the Chromia signer roster while every
          agent card showed an ERC-8004 id from BNB Smart Chain, so a registered
          agent sat next to a zero. Each count names its chain now. */}
      <StatStrip>
        <Stat label="Agents" value={total} />
        <Stat label="Running" value={runningCount} accent={runningCount > 0} />
        <Stat
          label="ERC-8004 registered"
          value={registeredCount}
          title="Agents holding an identity on BNB Smart Chain."
        />
        {/* Not a plain count: a 0 here read as "nobody has used the agents
            yet", which is wrong and sent people looking for a bug in their own
            usage. Atbash answers every action from a key it has not onboarded
            with "Agent not registered", so nothing can reach Chromia until the
            fleet's pubkeys are onboarded there. Show that, not a zero. */}
        <Stat
          label="Signing on Chromia"
          value={fleetAgents.length || "—"}
          title={
            fleetAgents.length
              ? "Agents that have signed at least one audited action."
              : "No agent can sign yet: Atbash rejects actions from an identity it has not onboarded (\"Agent not registered\"), and agent keys are minted here. Onboard the fleet's pubkeys in an Atbash org to start the audit trail."
          }
        />
      </StatStrip>

      <div className="space-y-3">
        <PanelLabel
          accent
          aside={total > 0 ? summary || `${total} on-chain` : "none deployed"}
        >
          Agents
        </PanelLabel>

        {/* The table is the roster; a row expands to the agent's own card, which
            keeps one implementation of the Telegram lookup, the Hermes login
            fetch and the lifecycle buttons. */}
        <FleetTable
          managed={managedRemote}
          renderDetail={(m) => (
            <ManagedAgentCard
              m={m}
              canControl={canControl}
              onManage={manage}
              onInspect={onInspectAgent}
            />
          )}
        />

        {/* Signers with no deployment row of their own: a different shape (no
            uptime, no spend, nothing to restart), so they stay cards rather
            than becoming half-empty table rows. */}
        {onChainOnly.length > 0 && (
          <div className="space-y-3 pt-2">
            <PanelLabel aside={`${onChainOnly.length} not deployed here`}>
              On-chain only
            </PanelLabel>
            {onChainOnly.map((a) => (
              <FleetMemberCard key={a.pubkey} a={a} onInspect={onInspectAgent} />
            ))}
          </div>
        )}

        {total === 0 && (
          <EmptyState
            action={
              <Button href="/dashboard" variant="accent" size="sm" arrow>
                Deploy an agent
              </Button>
            }
          >
            No agents deployed yet.
          </EmptyState>
        )}
      </div>
    </div>
  );
}
