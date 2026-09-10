import { getOwner, getSession } from "@/lib/dashboard/auth";
import { BillingView } from "@/components/dashboard/billing";
import { emptyPlanSummary, planSummary } from "@/lib/dashboard/plan";

// Plan. The summary is resolved server-side so the tier renders correctly on the
// first frame; `reason=deploy` is set by the deploy flow when a no-plan company
// tries to provision, and drives the "pick a plan" banner.
export const dynamic = "force-dynamic";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const [{ reason }, owner, session] = await Promise.all([
    searchParams,
    getOwner(),
    getSession(),
  ]);
  const summary = owner ? await planSummary(owner.companyId) : emptyPlanSummary();

  return (
    <div className="animate-reveal">
      <BillingView
        canControl={session?.role === "admin"}
        reason={reason ?? null}
        initialSummary={summary}
      />
    </div>
  );
}
