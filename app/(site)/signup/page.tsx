import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AuthForm } from "@/components/site/auth-form";
import { getSession } from "@/lib/dashboard/auth";
import { safeNextPath } from "@/lib/next-path";

export const metadata = { title: "Create account · decenchro" };

// Already signed in? Don't show the form. This check used to live in the proxy,
// which paid for it on every page navigation site-wide; the proxy is now scoped
// to /dashboard, so the two pages that actually care check for themselves.
export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  // Forward ?next on the redirect. Dropping it here silently broke the
  // marketplace hire flow for anyone already signed in: the CTA carries
  // ?next=/dashboard?category=defi-*, and landing on a bare /dashboard means
  // the deploy form has nothing to preselect.
  const next = (await searchParams).next;
  if (await getSession()) {
    redirect(safeNextPath(Array.isArray(next) ? next[0] : next));
  }
  return (
    <Suspense>
      <AuthForm mode="signup" />
    </Suspense>
  );
}
