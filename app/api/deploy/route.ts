import { NextResponse } from "next/server";

import { isAgentCategoryId } from "@/lib/dashboard/agent-categories";
import { getOwner, isRequestAdmin, isRequestAuthed } from "@/lib/dashboard/auth";
import { BOOT_BACKSTOP_MS, getDeployment, provisionAgent } from "@/lib/dashboard/deploy";
import { CLOUD_PROVIDERS, type CloudProvider } from "@/lib/dashboard/deploy-types";
import { grantSignupCredits } from "@/lib/dashboard/credit-ledger";
import { SELF_SERVE_AGENT_LIMIT } from "@/lib/dashboard/credits";
import { planSummary } from "@/lib/dashboard/plan";

export const dynamic = "force-dynamic";
// Provisioning now includes a best-effort ERC-8004 registration (up to 20s of
// BSC transactions) on top of the Render create call — keep headroom above
// Vercel's 10s hobby default.
export const maxDuration = 60;

// Which host every agent provisions on — server-authoritative, and there is only
// one since DigitalOcean and Hetzner were retired (2026-08-18).
//
// Still resolved through CLOUD_PROVIDERS rather than hardcoded at the call site:
// a DEPLOY_PROVIDER naming something we no longer support must not silently
// provision somewhere else. That exact bug shipped once, when the old
// `=== "hetzner" ? … : "digitalocean"` form sent DEPLOY_PROVIDER=render to
// DigitalOcean.
function deployProvider(): CloudProvider {
  const want = process.env.DEPLOY_PROVIDER?.trim().toLowerCase();
  const match = CLOUD_PROVIDERS.find((p) => p.id === want);
  return match?.id ?? "render";
}

// GET /api/deploy?id= — live progress for a deployment (no secrets). Ownership
// is enforced: the row must belong to the caller's company.
export async function GET(req: Request) {
  if (!(await isRequestAuthed()))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const owner = await getOwner();
  if (!owner)
    return NextResponse.json({ error: "no company profile" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { getDeploymentRow } = await import("@/lib/dashboard/deployments");
  const row = await getDeploymentRow(id);
  if (!row || row.company_id !== owner.companyId)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const deployment = await getDeployment(id);
  return NextResponse.json({ deployment });
}

// POST /api/deploy — provision a new cloud agent for the caller's company.
export async function POST(req: Request) {
  if (!(await isRequestAdmin()))
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  const owner = await getOwner();
  if (!owner)
    return NextResponse.json({ error: "no company profile" }, { status: 403 });

  await grantSignupCredits(owner.companyId).catch(() => {});

  const plan = await planSummary(owner.companyId);
  if (plan.needsCredits)
    return NextResponse.json({ error: "credits_required" }, { status: 402 });
  if (plan.atLimit)
    return NextResponse.json(
      {
        error: "agent_limit",
        detail: `Self-serve accounts run up to ${SELF_SERVE_AGENT_LIMIT} agents. Contact us for Enterprise.`,
      },
      { status: 403 },
    );

  let body: {
    agentName?: string;
    atbashKey?: string;
    telegramBotToken?: string;
    telegramAllowedUsers?: string;
    soulMd?: string;
    category?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // The category selects the agent's instructions, so an unrecognised id is
  // rejected rather than quietly defaulted. Omitting it is still fine: that's an
  // older client, and provisionAgent falls back to the default category.
  const category = body.category;
  if (category !== undefined && !isAgentCategoryId(category))
    return NextResponse.json({ error: "unknown category" }, { status: 400 });

  // Keys may be blank here: provisionAgent falls back to values already saved
  // on this host (~/.hermes/.env) and returns a clear "missing required keys"
  // error if a key is available from neither the request nor the saved env. The
  // model and OpenRouter key are platform-provided, so they're not accepted here.
  const atbashKey = (body.atbashKey ?? "").trim();
  const telegramBotToken = (body.telegramBotToken ?? "").trim();
  const expiresAt = new Date(Date.now() + BOOT_BACKSTOP_MS).toISOString();

  try {
    const { deployment } = await provisionAgent(
      {
        agentName: (body.agentName ?? "").trim(),
        provider: deployProvider(),
        atbashKey,
        telegramBotToken,
        telegramAllowedUsers: (body.telegramAllowedUsers ?? "").trim(),
        soulMd: body.soulMd ?? "",
        category,
        expiresAt,
      },
      owner,
    );
    return NextResponse.json({ deployment }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "deploy failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
