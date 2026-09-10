import { redirect } from "next/navigation";

import { getOwner, getSession } from "@/lib/dashboard/auth";
import { grantSignupCredits } from "@/lib/dashboard/credit-ledger";
import { listReconciledAgents } from "@/lib/dashboard/deploy";
import { getPresence } from "@/lib/dashboard/env-rw";
import { getIdentity } from "@/lib/dashboard/governance";
import { getStatus } from "@/lib/dashboard/hermes-control";
import {
  emptyPlanSummary,
  planSummary,
  type PlanSummary,
} from "@/lib/dashboard/plan";
import { telegramReuse } from "@/lib/dashboard/telegram-token";

import { DashboardClient } from "./dashboard-client";

// Overview / deploy wizard. The session gate and the shell live in layout.tsx.
export const dynamic = "force-dynamic";

// Sections used to be ?tab= on this one route. Those URLs are bookmarked, and
// /api/deploy's 402 path sent operators to ?tab=billing, so they redirect rather
// than silently landing on the wizard.
const LEGACY_TABS: Record<string, string> = {
  fleet: "/dashboard/fleet",
  // Analytics merged into the Fleet card (2026-08-28).
  analytics: "/dashboard/fleet",
  atbash: "/dashboard/atbash",
  billing: "/dashboard/billing",
  memory: "/dashboard",
  overview: "/dashboard",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; reason?: string }>;
}) {
  const { tab, reason } = await searchParams;
  if (tab) {
    const target = LEGACY_TABS[tab];
    if (target && target !== "/dashboard") {
      redirect(reason ? `${target}?reason=${encodeURIComponent(reason)}` : target);
    }
  }

  const [presence, status, identity, owner, session] = await Promise.all([
    getPresence(),
    getStatus(),
    getIdentity(),
    getOwner(),
    getSession(),
  ]);

  // The signup grant has to land before the balance is read, or a brand-new
  // account renders its first paint with nothing in it.
  if (owner) await grantSignupCredits(owner.companyId).catch(() => {});

  // Deploy is not gated up front: the form always shows, and the Deploy POST
  // routes an unfunded company to /dashboard/billing?reason=deploy (402).
  // Both resolved server-side. hasAgents in particular: it was hardcoded false,
  // so the wizard rendered its "no agents yet" state on every load and corrected
  // itself once /api/agents answered on the client.
  const [initialPlan, hasAgents, tgReuse] = await Promise.all([
    owner
      ? planSummary(owner.companyId)
      : Promise.resolve<PlanSummary>(emptyPlanSummary()),
    owner
      ? listReconciledAgents(owner.companyId).then(
          (a) => a.some((x) => x.status !== "deleted"),
          () => false,
        )
      : Promise.resolve(false),
    owner
      ? telegramReuse(owner.companyId).catch(() => ({
          token: null,
          heldBy: null,
        }))
      : Promise.resolve({ token: null, heldBy: null }),
  ]);

  // The deploy form's "saved · leave blank to keep" affordance. getPresence()
  // only ever answers for a self-hosted ~/.hermes/.env, so on the hosted console
  // it is always "missing" — the company's own reusable token is what makes the
  // offer true there. Deliberately a boolean: the token itself stays server-side
  // and a blank field is resolved in provisionAgent.
  const canReuseTelegram = Boolean(tgReuse.token) && !tgReuse.heldBy;
  if (canReuseTelegram) presence.TELEGRAM_BOT_TOKEN = "present";

  return (
    <DashboardClient
      initialPresence={presence}
      initialStatus={status}
      identity={identity}
      canControl={session?.role === "admin"}
      initialHasAgents={hasAgents}
      initialBilling={initialPlan}
    />
  );
}
