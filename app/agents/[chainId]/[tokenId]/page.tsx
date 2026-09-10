import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/site/button";
import { listAttestations } from "@/lib/dashboard/erc8004-attestations";
import {
  bscExplorerBase,
  ERC8004_IDENTITY_REGISTRY,
  explorerAddressUrl,
  explorerTxUrl,
  scan8004AgentUrl,
  shortAddress,
} from "@/lib/erc8004-links";
import { agentLiveActivity } from "@/lib/marketplace/activity";
import {
  classifyAgent,
  consoleHireHref,
  hireHref,
  marketplaceCategory,
} from "@/lib/marketplace/categories";
import {
  decenchroAgentByToken,
  type DecenchroPublicAgent,
} from "@/lib/marketplace/decenchro";
import {
  fetchRegistrationFile,
  readAgentIdentity,
} from "@/lib/marketplace/registry";
import { scanAgentDetail, type ScanAgentDetail } from "@/lib/marketplace/scan8004";
import { chainLabel, timeAgo } from "@/lib/marketplace/types";

import { AgentImage } from "../../agent-image";
import { CopyRow, LivePanel } from "../../detail-client";

// Public detail page for one ERC-8004 agent. Primary source is 8004scan's
// detail endpoint; when the indexer is down or hasn't seen a fresh mint yet,
// the page falls back to reading the IdentityRegistry directly (ownerOf +
// tokenURI + the registration file). Decenchro-deployed agents additionally
// show live status, the guarded-action count, and on-chain attestations.

export const revalidate = 120;

type Params = { chainId: string; tokenId: string };

function parseParams(p: Params): { chainId: number; tokenId: string } | null {
  const chainId = Number.parseInt(p.chainId, 10);
  if (chainId !== 56 && chainId !== 97) return null;
  if (!/^\d{1,78}$/.test(p.tokenId)) return null;
  return { chainId, tokenId: p.tokenId };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const parsed = parseParams(await params);
  if (!parsed) return { title: "Agent marketplace · Decenchro" };
  const [detail, ours] = await Promise.all([
    scanAgentDetail(parsed.chainId, parsed.tokenId),
    decenchroAgentByToken(parsed.chainId, parsed.tokenId),
  ]);
  const name = ours?.name ?? detail?.name ?? `Agent #${parsed.tokenId}`;
  return {
    title: `${name} · Agent marketplace · Decenchro`,
    description:
      detail?.description ??
      `ERC-8004 agent #${parsed.tokenId} on ${chainLabel(parsed.chainId)}.`,
  };
}

// Registration-file shapes vary by issuer; pull out anything that looks like a
// named endpoint without trusting the structure.
function fileServices(file: unknown): { name: string; endpoint: string }[] {
  if (!file || typeof file !== "object") return [];
  const services = (file as { services?: unknown }).services;
  const out: { name: string; endpoint: string }[] = [];
  if (Array.isArray(services)) {
    for (const s of services) {
      if (s && typeof s === "object") {
        const name = String((s as { name?: unknown }).name ?? "service");
        const endpoint = (s as { endpoint?: unknown }).endpoint;
        if (typeof endpoint === "string" && endpoint) out.push({ name, endpoint });
      }
    }
  } else if (services && typeof services === "object") {
    for (const [name, v] of Object.entries(services as Record<string, unknown>)) {
      const endpoint =
        v && typeof v === "object" ? (v as { endpoint?: unknown }).endpoint : v;
      if (typeof endpoint === "string" && endpoint) out.push({ name, endpoint });
    }
  }
  return out;
}

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const parsed = parseParams(await params);
  if (!parsed) notFound();
  const { chainId, tokenId } = parsed;

  const [detail, ours] = await Promise.all([
    scanAgentDetail(chainId, tokenId),
    decenchroAgentByToken(chainId, tokenId),
  ]);

  // Registry fallback: only consulted when 8004scan has nothing, so a healthy
  // index costs zero RPC reads.
  let fallbackFile: unknown = null;
  let fallbackOwner: string | null = null;
  let registrationUri: string | null = detail?.raw_metadata?.offchain_uri ?? null;
  if (!detail) {
    const identity = await readAgentIdentity(chainId, tokenId);
    if (!identity && !ours) notFound();
    fallbackOwner = identity?.owner ?? null;
    registrationUri = identity?.tokenURI ?? null;
    if (identity?.tokenURI) {
      fallbackFile = await fetchRegistrationFile(identity.tokenURI);
    }
  }

  const file: unknown = detail?.raw_metadata?.offchain_content ?? fallbackFile;
  const f = (file ?? {}) as Record<string, unknown>;

  const name =
    ours?.name ??
    detail?.name ??
    (typeof f.name === "string" ? f.name : null) ??
    `Agent #${tokenId}`;
  const description =
    detail?.description ??
    (typeof f.description === "string" ? f.description : "") ??
    "";
  const imageUrl =
    detail?.image_url ?? (typeof f.image === "string" ? f.image : null);
  const ownerAddress = detail?.owner_address ?? fallbackOwner;
  const agentWallet = detail?.agent_wallet ?? ours?.bscAddress ?? null;
  const createdTx = detail?.created_tx_hash ?? ours?.registrationTx ?? null;
  const createdAt = detail?.created_at ?? ours?.createdAt ?? null;

  const categoryId =
    ours?.categoryId ??
    classifyAgent({
      chainId,
      tokenId,
      name,
      description,
      tags: detail?.tags,
      categories: detail?.categories,
    });
  const category = categoryId ? marketplaceCategory(categoryId) : null;

  // What the hire CTA preselects. One of our own agents always knows its deploy
  // category, even when that category maps to none of the four marketplace jobs
  // — a `general` agent belongs in no section but still has a form to prefill,
  // and sending it through without one lands the visitor on a blank wizard.
  // Third-party listings only ever have the classified marketplace category.
  const hireCategoryId =
    ours?.agentCategoryId ?? category?.deployCategoryId ?? null;

  const [live, attestations] = await Promise.all([
    agentLiveActivity(chainId, tokenId),
    ours ? listAttestations(ours.deploymentId, 8) : Promise.resolve([]),
  ]);

  const services = collectServices(detail, file);
  const registry =
    ERC8004_IDENTITY_REGISTRY[chainId] ?? ERC8004_IDENTITY_REGISTRY[97];
  const caip = `eip155:${chainId}:${registry.toLowerCase()}:${tokenId}`;
  const nowMs = Date.now();

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 pb-16 md:px-10">
      {/* ── Header ── */}
      <div className="border-b border-rule py-8 md:py-10">
        <Link
          href="/agents"
          className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-soft transition-colors hover:text-accent"
        >
          <span aria-hidden>&larr;</span> All agents
        </Link>
        <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-start">
          <AgentImage src={imageUrl} name={name} size="lg" />
          <div className="min-w-0">
            <h1 className="break-words text-[clamp(24px,3.5vw,32px)] font-medium leading-tight tracking-[-0.015em] text-ink">
              {name}
            </h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Badge>{chainLabel(chainId)}</Badge>
              {ours && (
                <Badge accent>
                  {ours.live && (
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 rounded-full bg-signal animate-blink"
                    />
                  )}
                  Verified by Decenchro
                </Badge>
              )}
              {detail?.is_endpoint_verified && <Badge accent>Endpoint verified</Badge>}
              {detail?.x402_supported && <Badge>x402</Badge>}
              {category && <Badge>{category.label}</Badge>}
              {!detail && (
                <Badge>read from the registry · not indexed yet</Badge>
              )}
            </div>
            {description && (
              <p className="mt-3 max-w-[640px] text-[15px] leading-relaxed text-ink-mid">
                {description}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="grid grid-cols-1 gap-8 pt-8 md:grid-cols-12">
        <div className="space-y-8 md:col-span-7 lg:col-span-8">
          <TrustPanel detail={detail} live={live} chainId={chainId} tokenId={tokenId} />

          <section>
            <PanelHeading>Services</PanelHeading>
            {services.length ? (
              <div className="mt-3 space-y-2">
                {services.map((s) => (
                  <CopyRow key={`${s.name}:${s.endpoint}`} label={s.name} value={s.endpoint} />
                ))}
              </div>
            ) : (
              <p className="mt-3 deck border border-rule bg-paper px-4 py-5 font-mono text-[12.5px] leading-relaxed text-ink-soft">
                No public endpoint published. The registration file below is the
                only interface this agent has declared.
              </p>
            )}
          </section>

          {ours && (
            <DecenchroPanel
              agent={ours}
              guardedActions={live.decenchro?.guardedActions ?? null}
              attestations={attestations.map((a) => ({
                id: a.id,
                createdAt: a.created_at,
                responseValue: a.response_value,
                requestTx: a.request_tx,
                responseTx: a.response_tx,
                chainId: a.chain_id,
              }))}
              nowMs={nowMs}
            />
          )}

          <section>
            <PanelHeading>Registration file</PanelHeading>
            <details className="group mt-3 deck border border-rule bg-paper">
              <summary className="cursor-pointer list-none px-4 py-3 font-mono text-[12.5px] text-ink-soft transition-colors hover:text-ink">
                <span aria-hidden className="mr-2 inline-block transition-transform group-open:rotate-90">
                  &#9656;
                </span>
                {file ? "View the raw registration file (JSON)" : "Registration file unavailable"}
                {registrationUri ? (
                  <span className="ml-2 break-all text-ink-faint">
                    ·{" "}
                    {registrationUri.startsWith("data:")
                      ? "stored on-chain as an inline data URI"
                      : registrationUri.length > 96
                        ? `${registrationUri.slice(0, 96)}…`
                        : registrationUri}
                  </span>
                ) : null}
              </summary>
              {file != null && (
                <pre className="max-h-[440px] overflow-auto border-t border-rule px-4 py-3 font-mono text-[12px] leading-relaxed text-ink">
                  {JSON.stringify(file, null, 2)}
                </pre>
              )}
            </details>
          </section>
        </div>

        {/* ── Right rail ── */}
        <div className="space-y-8 md:col-span-5 lg:col-span-4">
          {ours ? (
            <section className="border border-accent/40 bg-paper p-5">
              <PanelHeading accent>Hire this agent</PanelHeading>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-mid">
                Deploy your own instance of this agent in one click. It runs on
                a server you control, and every action lands on a tamper-proof
                record. No wallet needed.
              </p>
              <div className="mt-4">
                <Button
                  href={hireCategoryId ? hireHref(hireCategoryId) : "/signup?next=%2Fdashboard"}
                  variant="accent"
                  arrow
                >
                  Hire this agent
                </Button>
              </div>
              {hireCategoryId && (
                <p className="mt-3 font-mono text-[12px] text-ink-faint">
                  Have an account?{" "}
                  <Link
                    href={consoleHireHref(hireCategoryId)}
                    className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
                  >
                    Open the console &rarr;
                  </Link>
                </p>
              )}
            </section>
          ) : (
            <section className="deck border border-rule bg-paper p-5">
              <PanelHeading>Engage</PanelHeading>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-mid">
                {services.length
                  ? "Connect over the agent's published endpoints. Decenchro lists this agent but does not operate it."
                  : "This agent has not published a public endpoint, so there is no direct way to engage it from here."}
              </p>
              {services[0] && (
                <div className="mt-4">
                  <CopyRow label={services[0].name} value={services[0].endpoint} />
                </div>
              )}
              <div className="mt-4">
                <Button
                  href={hireCategoryId ? hireHref(hireCategoryId) : "/signup?next=%2Fdashboard"}
                  variant="accent"
                  size="sm"
                  arrow
                >
                  Deploy an agent like this
                </Button>
              </div>
              <p className="mt-3 font-mono text-[12px] leading-relaxed text-ink-faint">
                Runs on Decenchro with a tamper-proof audit trail.
              </p>
            </section>
          )}

          <LivePanel
            chainId={chainId}
            tokenId={tokenId}
            explorerTxBase={`${bscExplorerBase(chainId)}/tx/`}
            initial={{ ok: true, ...live }}
          />

          <section className="deck border border-rule bg-paper">
            <div className="border-b border-rule px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.14em] text-ink-faint">
              Identity
            </div>
            <dl className="divide-y divide-rule">
              <KV label="Agent id" value={`#${tokenId}`} />
              <KV
                label="Registry"
                value={shortAddress(registry)}
                href={explorerAddressUrl(chainId, registry)}
              />
              {agentWallet && (
                <KV
                  label="Agent wallet"
                  value={shortAddress(agentWallet)}
                  href={explorerAddressUrl(chainId, agentWallet)}
                />
              )}
              {ownerAddress && (
                <KV
                  label="Owner"
                  value={shortAddress(ownerAddress)}
                  href={explorerAddressUrl(chainId, ownerAddress)}
                />
              )}
              {createdTx && (
                <KV
                  label="Registration tx"
                  value={`${createdTx.slice(0, 10)}…`}
                  href={explorerTxUrl(chainId, createdTx)}
                />
              )}
              {createdAt && (
                <KV
                  label="Registered"
                  value={timeAgo(createdAt, nowMs) ?? createdAt.slice(0, 10)}
                />
              )}
            </dl>
            <div className="border-t border-rule px-4 py-3">
              <CopyRow label="CAIP id" value={caip} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function collectServices(
  detail: ScanAgentDetail | null,
  file: unknown,
): { name: string; endpoint: string }[] {
  const rows: { name: string; endpoint: string }[] = [];
  const push = (name: string, endpoint: string | null | undefined) => {
    if (!endpoint) return;
    if (rows.some((r) => r.endpoint === endpoint)) return;
    rows.push({ name, endpoint });
  };
  push("A2A endpoint", detail?.a2a_endpoint);
  push("MCP server", detail?.mcp_server);
  push("Agent URL", detail?.agent_url);
  for (const s of fileServices(file)) push(s.name, s.endpoint);
  return rows.slice(0, 8);
}

function Badge({
  children,
  accent = false,
}: {
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[12px] ${
        accent
          ? "bg-accent-soft text-accent"
          : "border border-rule text-ink-soft"
      }`}
    >
      {children}
    </span>
  );
}

function PanelHeading({
  children,
  accent = false,
}: {
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <h2
      className={`font-mono text-[12px] uppercase tracking-[0.14em] ${
        accent ? "text-accent" : "text-ink-faint"
      }`}
    >
      {children}
    </h2>
  );
}

function KV({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-faint">
        {label}
      </dt>
      <dd className="min-w-0 truncate font-mono text-[12.5px] tabular-nums text-ink">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
          >
            {value} <span aria-hidden>&#8599;</span>
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function TrustPanel({
  detail,
  live,
  chainId,
  tokenId,
}: {
  detail: ScanAgentDetail | null;
  live: Awaited<ReturnType<typeof agentLiveActivity>>;
  chainId: number;
  tokenId: string;
}) {
  const avg =
    detail && detail.total_feedbacks > 0 ? Math.round(detail.average_score) : null;
  return (
    <section>
      <PanelHeading>Trust</PanelHeading>
      <div className="mt-3">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <TrustCell
            label="Avg feedback"
            value={avg != null ? `${avg}/100` : "—"}
            accent={avg != null}
          />
          <TrustCell
            label="Feedbacks"
            value={
              detail ? detail.total_feedbacks.toLocaleString("en-US") : "—"
            }
          />
          <TrustCell
            label="Validations"
            value={
              detail
                ? `${detail.successful_validations.toLocaleString("en-US")}/${detail.total_validations.toLocaleString("en-US")}`
                : "—"
            }
          />
          <TrustCell
            label="Endpoint check"
            value={
              detail ? (detail.is_endpoint_verified ? "verified" : "unverified") : "—"
            }
            accent={Boolean(detail?.is_endpoint_verified)}
          />
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-rule bg-paper px-4 py-3">
          <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-faint">
            Live registry read
          </span>
          <span className="font-mono text-[12.5px] tabular-nums text-ink">
            {live.reputation
              ? live.reputation.count > 0
                ? `${live.reputation.count.toLocaleString("en-US")} feedbacks · avg ${
                    live.reputation.score != null
                      ? Math.round(live.reputation.score)
                      : "—"
                  }/100 · ${live.reputation.clients.toLocaleString("en-US")} clients`
                : "no feedback recorded on-chain"
              : "registry unreachable right now"}
          </span>
          <a
            href={scan8004AgentUrl(chainId, Number(tokenId))}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="ml-auto font-mono text-[12px] text-accent transition-colors hover:text-ink"
          >
            View on 8004scan <span aria-hidden>&#8599;</span>
          </a>
        </div>
      </div>
    </section>
  );
}

function TrustCell({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="deck border border-rule bg-paper px-4 py-3">
      <div className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-faint">
        {label}
      </div>
      <div
        className={`mt-1 font-mono text-[17px] tabular-nums ${
          accent ? "text-accent" : "text-ink"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function DecenchroPanel({
  agent,
  guardedActions,
  attestations,
  nowMs,
}: {
  agent: DecenchroPublicAgent;
  guardedActions: number | null;
  attestations: {
    id: string;
    createdAt: string;
    responseValue: number | null;
    requestTx: string | null;
    responseTx: string | null;
    chainId: number;
  }[];
  nowMs: number;
}) {
  return (
    <section>
      <PanelHeading accent>Audit trail</PanelHeading>
      <div className="mt-3 deck border border-rule bg-paper">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule px-4 py-3">
          <span className="flex items-center gap-2 font-mono text-[12.5px] text-ink">
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${
                agent.live ? "bg-signal animate-blink" : "bg-rule-strong"
              }`}
            />
            {agent.live ? "running" : agent.status}
          </span>
          <span className="font-mono text-[12.5px] tabular-nums text-ink">
            {guardedActions != null
              ? `${guardedActions.toLocaleString("en-US")} guarded actions on record`
              : "audit feed unavailable right now"}
          </span>
          {agent.lastSeen && (
            <span className="ml-auto font-mono text-[12px] text-ink-faint">
              last seen {timeAgo(agent.lastSeen, nowMs)}
            </span>
          )}
        </div>
        <p className="border-b border-rule px-4 py-3 text-[13.5px] leading-relaxed text-ink-mid">
          Every action this agent takes is checked before it runs and recorded
          on Chromia. Daily summaries are anchored on {chainLabel(agent.chainId)}{" "}
          through the ERC-8004 ValidationRegistry.
        </p>
        {attestations.length ? (
          <ul className="divide-y divide-rule">
            {attestations.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2.5 font-mono text-[12.5px] tabular-nums"
              >
                <span className="text-ink">{a.createdAt.slice(0, 10)}</span>
                <span className={a.responseValue != null ? "text-accent" : "text-ink-faint"}>
                  {a.responseValue != null ? `score ${a.responseValue}/100` : "pending"}
                </span>
                <span className="ml-auto flex gap-3">
                  {a.requestTx && (
                    <AttTx chainId={a.chainId} tx={a.requestTx} label="request" />
                  )}
                  {a.responseTx && (
                    <AttTx chainId={a.chainId} tx={a.responseTx} label="response" />
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 font-mono text-[12.5px] text-ink-faint">
            No attestations anchored yet. The first daily summary lands within
            24 hours of deployment.
          </p>
        )}
      </div>
    </section>
  );
}

function AttTx({ chainId, tx, label }: { chainId: number; tx: string; label: string }) {
  return (
    <a
      href={explorerTxUrl(chainId, tx)}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
    >
      {label} <span aria-hidden>&#8599;</span>
    </a>
  );
}
