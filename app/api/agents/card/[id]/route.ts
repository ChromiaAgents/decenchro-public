import { NextResponse } from "next/server";

import { appBaseUrl } from "@/lib/dashboard/app-url";
import { agentCategory } from "@/lib/dashboard/agent-categories";
import { decrypt } from "@/lib/dashboard/crypto";
import { erc8004Registries } from "@/lib/dashboard/erc8004-abi";
import { getDeploymentRow, metricsBase } from "@/lib/dashboard/deployments";

export const dynamic = "force-dynamic";

// GET /api/agents/card/<deploymentId> — the agent's ERC-8004 registration file.
//
// Deliberately public and unauthenticated: this URL is the agentURI minted into
// the IdentityRegistry, so it must be world-readable. Deployment ids are
// unguessable uuids, and the body contains only what the on-chain registration
// already implies (name, category, public endpoints) — no owner data, no
// secrets. Platform-hosted (rather than agent-hosted) so the URI is stable
// before the Render service exists and survives endpoint churn.

// A bot's @handle never changes for a given token; cache for the process
// lifetime like app/api/agents/telegram does.
const handleCache = new Map<string, string>();

async function telegramHandle(id: string, tokenEnc: string): Promise<string | null> {
  const cached = handleCache.get(id);
  if (cached) return cached;
  try {
    const token = decrypt(tokenEnc);
    if (!token) return null;
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok: boolean; result?: { username?: string } };
    const username = body.ok ? body.result?.username ?? null : null;
    if (username) handleCache.set(id, username);
    return username;
  } catch {
    return null;
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const row = await getDeploymentRow(id);
  if (!row || row.status === "deleted") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const base = appBaseUrl();
  const category = agentCategory(row.category_id);

  const services: { name: string; endpoint: string }[] = [
    { name: "web", endpoint: base },
  ];
  const handle = await telegramHandle(row.id, row.telegram_token_enc);
  if (handle) services.push({ name: "telegram", endpoint: `https://t.me/${handle}` });
  // Only Render rows publish a status endpoint: it's HTTPS on a stable
  // hostname. Historical VM rows would leak a raw ip:port — never put that in
  // an on-chain card.
  if (row.provider === "render") {
    const endpoint = metricsBase(row);
    if (endpoint) services.push({ name: "status", endpoint: `${endpoint}/health` });
  }

  const card: Record<string, unknown> = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: row.agent_name,
    description:
      `${category.label} deployed on Decenchro. Every tool call is judged by ` +
      `Atbash before it runs and recorded on Chromia; the audit trail is ` +
      `anchored on BNB Smart Chain via the ERC-8004 ValidationRegistry.`,
    image: `${base}/icon.svg`,
    services,
  };

  // Present once registered (the card is minted before the tx confirms, so the
  // first fetches may not have it yet).
  if (row.erc8004_agent_id != null && row.erc8004_chain_id != null) {
    card.registrations = [
      {
        agentId: row.erc8004_agent_id,
        agentRegistry: `eip155:${row.erc8004_chain_id}:${
          erc8004Registries(row.erc8004_chain_id).identity
        }`,
      },
    ];
  }

  return NextResponse.json(card, {
    headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=600" },
  });
}
