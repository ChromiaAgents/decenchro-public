import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/shell";
import { authEnabled, getCompanyName, getSession } from "@/lib/dashboard/auth";
import { appEnvironment } from "@/lib/dashboard/environment";

// Session gate + persistent chrome for every dashboard section.
//
// The gate lives here rather than in each page so a new section cannot ship
// unauthenticated by forgetting it, and the shell lives here so navigating
// between sections replaces only the page slot.
export const dynamic = "force-dynamic";

// The console is cloud-only: the "this host" local launch path was retired
// (user decision 2026-07-13). Agents are deployed to Render and operated from
// the Fleet section, so the first nav item is the deploy wizard.
const HOSTED = true;

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login?next=/dashboard");

  const company = await getCompanyName();

  return (
    <DashboardShell
      authEnabled={authEnabled()}
      session={session}
      company={company}
      hosted={HOSTED}
      environment={appEnvironment()}
    >
      {children}
    </DashboardShell>
  );
}
