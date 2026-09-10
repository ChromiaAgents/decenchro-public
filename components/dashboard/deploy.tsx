"use client";

import { motion } from "framer-motion";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { SectionHeader } from "@/components/dashboard/section-header";
import { randomAgentName } from "@/lib/dashboard/agent-name";
import {
  ActionButton,
  Banner,
  Panel,
  PrimaryButton,
} from "@/components/dashboard/ui";
import {
  DEFAULT_AGENT_CATEGORY,
  isAgentCategoryId,
  TOP_LEVEL_CATEGORIES,
  topLevelOf,
  type AgentCategoryId,
} from "@/lib/dashboard/agent-categories";
import {
  CLOUD_PROVIDERS,
  type Deployment,
  type DeployStep,
} from "@/lib/dashboard/deploy-types";

// Cloud deployment surface of the "Set up your agent" flow. Two phases: a short
// form to collect the new agent's name/identity/chat, then a live progress view
// that polls the registry as the VPS boots and reports cloud-init phases back.
// The model and LLM access are platform-provided, so the operator no longer
// picks a model or enters an OpenRouter key, and the host is fixed server-side.

// Progress polling for a live deployment. Deliberately bounded: this is the
// tightest loop in the console, and it must not outlive the deploy it watches.
const POLL_INTERVAL_MS = 2_000;
/** ~20 minutes — well past a normal VPS provision + cloud-init run. */
const POLL_MAX_TICKS = 600;
/** Consecutive failed reads before we stop and tell the operator to reload. */
const POLL_MAX_ERRORS = 10;

type Check = { valid: boolean; detail?: string } | null;

// Debounced live credential check against /api/config/validate (Telegram getMe).
// Only fires once the value looks complete, so we don't flash "✗ rejected"
// mid-type or hammer the provider on every keystroke.
function useCredentialCheck(
  value: string,
  keyName: "OPENROUTER_API_KEY" | "TELEGRAM_BOT_TOKEN",
  looksComplete: (v: string) => boolean,
): { checking: boolean; result: Check } {
  const [result, setResult] = useState<Check>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    const v = value.trim();
    if (!looksComplete(v)) {
      setResult(null);
      setChecking(false);
      return;
    }
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch("/api/config/validate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: keyName, value: v }),
        });
        const d = await r.json();
        setResult({ valid: Boolean(d.valid), detail: d.detail });
      } catch {
        setResult({ valid: false, detail: "network error" });
      } finally {
        setChecking(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [value, keyName, looksComplete]);
  return { checking, result };
}

const looksLikeTgToken = (v: string) => /^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(v);

// The deploy form is unmounted when the operator hops to the Credits tab to top
// up, so its inputs are stashed in sessionStorage and rehydrated on return —
// they fill the form once, buy credits, then confirm. Cleared on a successful
// deploy. Per-tab (sessionStorage), never leaves the browser.
const DRAFT_KEY = "decenchro:deploy-draft";
type DeployDraft = {
  agentName: string;
  telegramBotToken: string;
  category: AgentCategoryId;
  // Whether agentName is a name we offered or one the operator typed. Lives in
  // the draft, not in a ref, because the form remounts (Credits hop, post-deploy
  // nonce, React's development double-invoke) and a ref cannot tell a restored
  // suggestion from typed input — it comes back empty, and the suggestion is
  // then treated as deliberate.
  nameSuggested: boolean;
};
function readDeployDraft(): Partial<DeployDraft> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function writeDeployDraft(d: DeployDraft): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* storage disabled/full — draft persistence is best-effort */
  }
}
function clearDeployDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

export function CloudDeployment({
  onBack,
  onDone,
  onSubmitted,
  onNeedsBilling,
  canDeploy = false,
  initial,
  saved,
  resumeId,
  standalone,
  initialCategory,
}: {
  onBack: () => void;
  canDeploy?: boolean;
  // Called on the success screen's "done" — e.g. to land on the Fleet tab
  // where the new agent now lives. Falls back to onBack when not provided.
  onDone?: () => void;
  // Called the moment a deploy is accepted (VPS provisioning kicked off). When
  // provided, the form hands off immediately — e.g. to the Fleet tab where
  // provisioning progress is shown — instead of taking over with an inline
  // progress view. This is what lets a second deploy start while the first is
  // still provisioning.
  onSubmitted?: () => void;
  // Called when the server rejects the deploy for lack of credits (402). The
  // parent switches to the Credits tab in-app — no reload, form state kept.
  onNeedsBilling?: () => void;
  // Prefill from the setup wizard so the operator doesn't re-enter keys they
  // already typed in the Identity/Keys steps. Optional — the standalone "add
  // another agent" modal renders this component with no prior values.
  initial?: {
    telegramBotToken?: string;
  };
  // Which keys are already saved on this host (~/.hermes/.env). When a key is
  // saved, the operator can leave the field blank and the server reuses the
  // saved value. Only passed from the setup wizard — "add another agent" needs
  // its own fresh identity, so it never offers to reuse saved keys.
  saved?: { telegram?: boolean };
  // Resume an in-flight deployment (e.g. after a page refresh): skip the form
  // and show live progress for this registry id straight away.
  resumeId?: string;
  // Rendered as the whole tab (hosted console) rather than a step reached from
  // the wizard/modal — there is nothing to cancel back to, so hide "cancel".
  standalone?: boolean;
  // Preselect the agent type (e.g. the marketplace hire flow's
  // /dashboard?category=defi-grid). An explicit prop wins over the URL param,
  // and both win over the sessionStorage draft when hydrating.
  initialCategory?: AgentCategoryId;
}) {
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set when the progress poll gives up (ceiling hit, or the status endpoint
  // stopped answering). Separate from `error`, which belongs to the form phase.
  const [stalled, setStalled] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // The marketplace hire flow lands here as /dashboard?category=defi-*. Read
  // via useSearchParams (safe: every /dashboard route is force-dynamic, so no
  // Suspense-at-build concern), validated because the id picks the agent's
  // instructions. The explicit prop wins over the URL.
  const searchParams = useSearchParams();
  const urlCategory = searchParams.get("category");
  const presetCategory: AgentCategoryId | null =
    initialCategory ?? (isAgentCategoryId(urlCategory) ? urlCategory : null);

  // form fields — start from server-safe values (prefill or empty) so SSR and
  // the first client render match; the saved draft (sessionStorage, client-only)
  // is applied after mount to avoid a hydration mismatch.
  const [category, setCategory] = useState<AgentCategoryId>(
    presetCategory ?? DEFAULT_AGENT_CATEGORY,
  );
  const [agentName, setAgentName] = useState("");
  const [telegramBotToken, setTelegramBotToken] = useState(
    initial?.telegramBotToken ?? "",
  );
  // Rehydrate from the draft once, on the client, so a hop to the Credits tab (and
  // the reload plan selection triggers) doesn't lose what was typed.
  const [draftHydrated, setDraftHydrated] = useState(false);
  // True while the name in the field is one we offered. Cleared the moment the
  // operator edits it, so we never overwrite a deliberate choice.
  const [nameSuggested, setNameSuggested] = useState(false);
  useEffect(() => {
    const d = readDeployDraft();
    if (d.agentName) {
      setAgentName(d.agentName);
      setNameSuggested(Boolean(d.nameSuggested));
    } else {
      // Offered, not imposed: the field is editable and the form is valid on
      // load, so deploying does not start with naming something that does not
      // exist yet. Generated here rather than in useState because a random
      // initial value differs between the server render and hydration.
      setAgentName(randomAgentName());
      setNameSuggested(true);
    }
    if (d.telegramBotToken) setTelegramBotToken(d.telegramBotToken);
    // Guard the stored id: sessionStorage can hold a category that was renamed
    // or removed from the catalog since the draft was written. An explicit
    // preselect (prop or ?category=) wins over the draft — someone arriving
    // from the marketplace asked for that category, this visit.
    if (!presetCategory && isAgentCategoryId(d.category)) setCategory(d.category);
    setDraftHydrated(true);
    // Mount-only on purpose: presetCategory is fixed for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Persist on change — but only after hydration, so the initial empty state
  // doesn't clobber a saved draft before it's read back.
  useEffect(() => {
    if (!draftHydrated) return;
    writeDeployDraft({ agentName, telegramBotToken, category, nameSuggested });
  }, [draftHydrated, agentName, telegramBotToken, category, nameSuggested]);
  // The roster fetch below is mount-only, so it closes over the first render's
  // state. This mirror is what lets it read the flag as it is when the response
  // lands, without re-running the fetch every time the name changes.
  const nameSuggestedRef = useRef(nameSuggested);
  nameSuggestedRef.current = nameSuggested;
  // Whether the company has a reusable Telegram token, asked on mount rather
  // than taken only from the `saved` prop. That prop is computed in
  // app/dashboard/page.tsx, and Next's router cache can hand this route a
  // payload built earlier in the session: navigate Fleet -> Deploy after saving
  // a token and the form offered the placeholder for a token the company
  // already had, until a hard refresh. Starts undefined so the prop still
  // drives the first paint and nothing flickers.
  const [reuseLive, setReuseLive] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    fetch("/api/deploy/reuse", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (alive && typeof j?.telegram === "boolean") setReuseLive(j.telegram);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Existing agent names (this company, non-deleted) so we can flag a duplicate
  // name before submit — names must be unique to stay readable at scale.
  const [takenNames, setTakenNames] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    fetch("/api/agents", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const taken = new Set<string>(
          (j.agents ?? []).map((a: { agentName?: string }) =>
            (a.agentName ?? "").trim().toLowerCase(),
          ),
        );
        setTakenNames(taken);
        // This list lands after mount, so the suggestion was made blind. Without
        // this the operator can be shown "you already have an agent named X" on
        // a field they never touched, blocking deploy until they edit it. Only a
        // name we offered is replaced; a typed one is left to the warning.
        setAgentName((current) =>
          nameSuggestedRef.current && taken.has(current.trim().toLowerCase())
            ? randomAgentName(taken)
            : current,
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Live verification of the Telegram bot token (debounced).
  const tg = useCredentialCheck(telegramBotToken, "TELEGRAM_BOT_TOKEN", looksLikeTgToken);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (id: string) => {
      stopPolling();
      setStalled(null);
      let ticks = 0;
      let consecutiveErrors = 0;
      const giveUp = (why: string) => {
        setStalled(why);
        stopPolling();
      };
      pollRef.current = setInterval(async () => {
        // Provisioning is minutes, not hours. Without a ceiling a deployment
        // that never leaves "running" (a stuck VPS, an API that keeps erroring)
        // polls every 2s for as long as the tab stays open.
        if (++ticks > POLL_MAX_TICKS) {
          giveUp("Still provisioning after 20 minutes. Reload to pick it back up.");
          return;
        }
        try {
          const res = await fetch(`/api/deploy?id=${id}`, { cache: "no-store" });
          if (!res.ok) {
            // A failing endpoint used to skip the stop check entirely and poll
            // forever; give up once it's clearly not coming back.
            if (++consecutiveErrors >= POLL_MAX_ERRORS)
              giveUp("Lost contact with the deployment status. Reload to retry.");
            return;
          }
          consecutiveErrors = 0;
          const d = await res.json();
          if (d.deployment) setDeployment(d.deployment);
          if (d.deployment && d.deployment.status !== "running") stopPolling();
        } catch {
          if (++consecutiveErrors >= POLL_MAX_ERRORS)
            giveUp("Lost contact with the deployment status. Reload to retry.");
        }
      }, POLL_INTERVAL_MS);
    },
    [stopPolling],
  );

  // Resume mode: hydrate the progress view from the registry immediately, then
  // poll like a fresh deploy. The registry row is the source of truth, so a
  // refreshed page picks up exactly where the VPS actually is.
  useEffect(() => {
    if (!resumeId) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/deploy?id=${resumeId}`, {
          cache: "no-store",
        });
        const d = await r.json();
        if (alive && d.deployment) setDeployment(d.deployment);
      } catch {
        // the poll below fills in
      }
    })();
    startPolling(resumeId);
    return () => {
      alive = false;
      stopPolling();
    };
  }, [resumeId, startPolling, stopPolling]);

  const submit = useCallback(async () => {
    if (!canDeploy) {
      onNeedsBilling?.();
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const r = await fetch("/api/deploy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentName,
          telegramBotToken,
          category,
        }),
      });
      const data = await r.json();
      if (r.status === 402 || data.error === "credits_required") {
        onNeedsBilling?.();
        return;
      }
      if (!r.ok) {
        setError(data.detail ?? data.error ?? "deploy failed");
        return;
      }
      // Provisioning accepted — the draft has served its purpose, clear it so a
      // remount starts fresh.
      clearDeployDraft();
      // Hand off to the caller (Fleet tab) rather than taking the page over with
      // inline progress, so the operator can immediately start another deploy.
      if (onSubmitted) {
        onSubmitted();
        return;
      }
      setDeployment(data.deployment);
      if (data.deployment?.status === "running") startPolling(data.deployment.id);
    } catch {
      setError("deploy failed");
    } finally {
      setSubmitting(false);
    }
  }, [
    canDeploy,
    agentName,
    telegramBotToken,
    category,
    startPolling,
    onSubmitted,
    onNeedsBilling,
  ]);

  // ── Resume hydration (registry fetch in flight — don't flash the form) ──
  if (!deployment && resumeId) {
    return (
      <div className="flex items-center gap-2.5 py-8">
        <span className="relative inline-flex h-2 w-2">
          <span className="absolute inset-0 animate-ping rounded-full bg-accent-bright opacity-60" />
          <span className="relative h-2 w-2 rounded-full bg-accent-bright" />
        </span>
        <p className="font-mono text-[12.5px] text-console-soft">
          Reconnecting to your deployment…
        </p>
      </div>
    );
  }

  // ── Form phase ──
  if (!deployment) {
    // The live answer wins once it lands; until then the server prop stands.
    const canReuse = reuseLive ?? Boolean(saved?.telegram);
    const tgReuse = canReuse && !telegramBotToken.trim();
    const nameTrimmed = agentName.trim();
    const nameTaken = takenNames.has(nameTrimmed.toLowerCase());
    const nameOk = nameTrimmed.length > 0 && !nameTaken;
    // No Atbash key to satisfy while governance is coming soon: the server
    // mints the agent identity itself.
    const ready = nameOk && (Boolean(tg.result?.valid) || tgReuse);
    return (
      <div className="space-y-6">
        <SectionHeader
          title="Deploy an agent"
          description="Pick what this agent does, name it, and connect a Telegram bot."
        />

        <CategoryPicker value={category} onChange={setCategory} />

        {/* Capped: the shell is 1200px wide for card grids and metric strips, but
            a single-column form stretched that far leaves an input the width of
            the viewport for a 20-character agent name. */}
        <div className="max-w-160 space-y-4">
          {/* Deliberately not <Field>: this is the one field with a control
              inside it, and Field wraps its children in a <label>. A button
              nested in a label is interactive content the spec disallows there,
              and assistive tech can fold the button's text into the input's
              accessible name ("Agent name Offer a different name"). So the
              label is associated by htmlFor instead, which keeps that name
              clean and the button out of it. */}
          <div className="space-y-1">
            <label
              htmlFor="agent-name"
              className="label-micro block text-console-faint"
            >
              Agent name
            </label>
            <div className="relative">
              <input
                id="agent-name"
                value={agentName}
                onChange={(e) => {
                  setAgentName(e.target.value);
                  // Typed now, so it is the operator's name: never re-suggested
                  // over, even if it turns out to collide.
                  setNameSuggested(false);
                }}
                placeholder="support-agent"
                // pr-12 keeps a long name from running under the button.
                className={`${inputCls} pr-12 ${
                  nameTaken ? "border-warn-ink/60 focus:border-warn-ink" : ""
                }`}
              />
              {/* inset-y-0 so the hit area is the full height of the input,
                  which carries the 44px touch floor on mobile — an icon-sized
                  box would be under it. */}
              <button
                type="button"
                aria-label="Offer a different name"
                title="Offer a different name"
                onClick={() => {
                  // The name on screen counts as taken for this one call, so a
                  // click always visibly changes the field. Without it 1 in 8000
                  // clicks returns the same name and reads as a dead button.
                  setAgentName(
                    randomAgentName(
                      new Set([...takenNames, nameTrimmed.toLowerCase()]),
                    ),
                  );
                  setNameSuggested(true);
                }}
                className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-lg text-console-faint transition-colors hover:text-accent-bright focus-visible:text-accent-bright focus-visible:outline-none"
              >
                <ShuffleGlyph />
              </button>
            </div>
            {nameTaken && (
              <span className="font-mono text-[12px] text-warn-ink">
                you already have an agent named “{nameTrimmed}”
              </span>
            )}
          </div>
          <Field label="Telegram bot token">
            <input
              value={telegramBotToken}
              onChange={(e) => setTelegramBotToken(e.target.value)}
              placeholder={
                tgReuse ? "•••••• (saved · leave blank to keep)" : "123456:ABC…"
              }
              spellCheck={false}
              autoComplete="off"
              className={`${inputCls} ${
                tg.result?.valid ? "border-accent-bright/60" : ""
              }`}
            />
            <CredHint
              checking={tg.checking}
              result={tg.result}
              href="https://t.me/BotFather"
              idleLabel="create a bot with @BotFather →"
              reuse={tgReuse}
            />
          </Field>
        </div>

        {error && <Banner tone="danger">{error}</Banner>}

        <div className="flex flex-wrap items-center gap-3">
          <PrimaryButton onClick={submit} disabled={!ready || submitting}>
            {submitting
              ? "provisioning…"
              : canDeploy
                ? "Confirm to deploy"
                : "Top up to deploy"}
          </PrimaryButton>
          {!standalone && <ActionButton onClick={onBack}>cancel</ActionButton>}
        </div>
      </div>
    );
  }

  // ── Progress phase ──
  const done = deployment.steps.filter((s) => s.state === "done").length;
  const pct = Math.round((done / deployment.steps.length) * 100);
  const failed = deployment.status === "failed";
  const succeeded = deployment.status === "succeeded";
  const providerLabel =
    CLOUD_PROVIDERS.find((p) => p.id === deployment.provider)?.label ??
    deployment.provider;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 100, damping: 20 }}
      className="space-y-6"
    >
      <SectionHeader
        title={
          succeeded
            ? "Your agent is deployed"
            : failed
              ? "Deployment failed"
              : `Deploying to ${providerLabel}`
        }
        description={`${providerLabel} · ${pct}%`}
      />

      {/* A square rule-coloured track with a teal fill: a progress bar is a
          measure, and a pill-shaped one reads as a control. */}
      <div className="h-1 overflow-hidden bg-console-rule">
        <div
          className={`h-full transition-all duration-500 ${
            failed ? "bg-danger" : "bg-accent-bright"
          }`}
          style={{ width: `${Math.max(pct, 4)}%` }}
        />
      </div>

      <Panel className="px-4 py-3 font-mono text-[12px] leading-relaxed">
        <div
          className={`label-micro mb-2 ${failed ? "text-danger" : "text-accent-bright"}`}
        >
          {failed ? "✕ deployment failed" : succeeded ? "✓ deployed" : "▲ deploying"}
        </div>
        {deployment.steps.map((s) => (
          <StepLine key={s.id} step={s} />
        ))}
      </Panel>

      {stalled && !succeeded && !failed && (
        <Banner tone="warn">
          {stalled} The agent keeps provisioning on the server either way.
        </Banner>
      )}

      {(succeeded || failed || stalled) && (
        <ActionButton onClick={!failed && succeeded ? (onDone ?? onBack) : onBack}>
          {succeeded && !failed ? "done" : "back to setup"}
        </ActionButton>
      )}
    </motion.div>
  );
}

// The one input treatment, shared with the marketplace's filter field. Inputs are
// the single exception to the sharp-corners rule (DESIGN.md), and they carry the
// 44px floor on touch so a thumb can hit them.
const inputCls =
  "w-full min-h-11 rounded-lg border border-console-rule bg-console px-3.5 py-2 font-mono text-[13px] text-console-ink placeholder:text-console-faint focus:border-accent-bright focus:outline-none md:min-h-0";

// Regenerate mark for the agent-name field: a circular arrow, same line-art
// idiom as CategoryGlyph (16px box, one stroke weight, currentColor so the
// button's hover colour drives it). Reads as "again" rather than dice, which at
// 16px turns into five indistinct dots.
function ShuffleGlyph() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* Open arc, so the arrowhead reads as the end of a rotation rather than
          a closed ring with a tick on it. */}
      <path d="M13 8a5 5 0 1 1-1.7-3.76" />
      <path d="M13 2.5V5h-2.5" />
    </svg>
  );
}

// Line-art mark per category, in currentColor so it picks up the accent when its
// card is selected. Kept to one stroke weight and a 16px box to sit like a label
// rather than an illustration.
function CategoryGlyph({ id }: { id: AgentCategoryId }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.25,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (id === "research")
    return (
      <svg {...common}>
        <circle cx="7" cy="7" r="4.25" />
        <path d="M10.2 10.2 14 14" />
      </svg>
    );
  if (id === "web3")
    return (
      <svg {...common}>
        <path d="M8 1.6l5.2 3v6.8L8 14.4l-5.2-3V4.6z" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M8 1.8 14.2 8 8 14.2 1.8 8z" />
    </svg>
  );
}

function CheckMark() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 6.4 4.7 9 10 3.4" />
    </svg>
  );
}

// What the agent is, chosen once. A real radiogroup rather than a row of
// buttons, so arrow keys work and screen readers announce the selection.
//
// Selection is marked by a check as well as the accent border: colour alone
// would leave it invisible to anyone who can't separate teal from grey. Cards
// stretch to equal height and pin their tag line to the bottom, so three cards
// of unequal copy still line up. Single column at 390px per the mobile rule.
function CategoryPicker({
  value,
  onChange,
}: {
  value: AgentCategoryId;
  onChange: (id: AgentCategoryId) => void;
}) {
  // The card is derived from the one id the form holds: a defi-* value lights
  // Web3, so a ?category=defi-grid hire link lands on the right card and keeps
  // its capability through the deploy.
  const top = topLevelOf(value);
  return (
    <div className="space-y-2.5">
      <span className="label-micro block text-console-faint">Agent type</span>
      <div
        role="radiogroup"
        aria-label="Agent type"
        className="grid grid-cols-1 gap-2 sm:grid-cols-3"
      >
        {TOP_LEVEL_CATEGORIES.map((c) => {
          // A capability keeps its parent card lit, so choosing "grid trading"
          // does not make the Web3 card look unselected.
          const active = c.id === top;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(c.id)}
              className={`flex h-full flex-col border px-4 py-3.5 text-left transition-colors focus:outline-none focus-visible:border-accent-bright ${
                active
                  ? "border-accent-bright bg-accent-soft"
                  : "border-console-rule bg-console hover:border-rule-strong"
              }`}
            >
              <span className="flex items-start justify-between gap-2">
                <span className={active ? "text-accent-bright" : "text-console-faint"}>
                  <CategoryGlyph id={c.id} />
                </span>
                {active && (
                  <span className="text-accent-bright">
                    <CheckMark />
                  </span>
                )}
              </span>
              <span
                className={`mt-2.5 block text-[15px] font-medium ${
                  active ? "text-console-ink" : "text-console-mid"
                }`}
              >
                {c.label}
              </span>
              <span className="mt-1 block text-[14px] leading-snug text-console-mid">
                {c.blurb}
              </span>
              <span className="label-micro mt-auto block pt-3 leading-relaxed text-console-faint">
                {c.tags.join(" · ")}
              </span>
            </button>
          );
        })}
      </div>

    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="label-micro block text-console-faint">{label}</span>
      {children}
    </label>
  );
}

// Live verification status under a credential field. Shows checking / valid (·
// detail) / invalid; falls back to the "where to get this" link when idle.
function CredHint({
  checking,
  result,
  href,
  idleLabel,
  reuse,
}: {
  checking: boolean;
  result: Check;
  href: string;
  idleLabel: string;
  // Saved on this host and the field is blank — show that the saved value is
  // reused instead of the "get a key" link.
  reuse?: boolean;
}) {
  // Teal for a pass, danger for a fail: on this ground teal is the only signal
  // colour, and the amber `warn` does not clear AA as text.
  if (checking)
    return <span className="font-mono text-[12px] text-console-faint">checking…</span>;
  if (result?.valid)
    return (
      <span className="font-mono text-[12px] text-accent-bright">
        ✓ valid{result.detail ? ` · ${result.detail}` : ""}
      </span>
    );
  if (result && !result.valid)
    return (
      <span className="font-mono text-[12px] text-danger">
        ✗ {result.detail ?? "invalid"}
      </span>
    );
  if (reuse)
    return (
      <span className="font-mono text-[12px] text-accent-bright">
        ✓ using your saved key
      </span>
    );
  return <HintLink href={href}>{idleLabel}</HintLink>;
}

// Small "where to get this" link shown under a credential field.
function HintLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-block font-mono text-[12px] text-accent-bright underline underline-offset-2"
    >
      {children}
    </a>
  );
}

function StepLine({ step }: { step: DeployStep }) {
  const cls =
    step.state === "done"
      ? "text-accent-bright"
      : step.state === "active"
        ? "text-console-ink"
        : step.state === "failed"
          ? "text-danger"
          : "text-console-faint";
  return (
    <div className={`flex items-baseline gap-2 ${cls}`}>
      <span className="inline-block w-3 shrink-0 text-center">
        {step.state === "done"
          ? "✓"
          : step.state === "failed"
            ? "✕"
            : step.state === "active"
              ? "◌"
              : "○"}
      </span>
      <span>{step.label}</span>
      {step.state === "active" && (
        <span className="inline-block animate-pulse">…</span>
      )}
      {/* Only the step in play explains itself. Every step carries a detail
          now, and printing four truncated sentences at once is noise. */}
      {step.detail && (step.state === "active" || step.state === "failed") && (
        <span className="min-w-0 truncate text-console-faint">
          · {step.detail}
        </span>
      )}
    </div>
  );
}
