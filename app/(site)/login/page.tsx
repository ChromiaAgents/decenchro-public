import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AuthForm } from "@/components/site/auth-form";
import { getSession } from "@/lib/dashboard/auth";
import { safeNextPath } from "@/lib/next-path";

export const metadata = { title: "Sign in · decenchro" };

// Already signed in? Don't show the form. This check used to live in the proxy,
// which paid for it on every page navigation site-wide; the proxy is now scoped
// to /dashboard, so the two pages that actually care check for themselves.
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  // Same as signup: honour ?next so a signed-in visitor keeps their
  // destination (and its query string) instead of being dumped on /dashboard.
  const next = (await searchParams).next;
  if (await getSession()) {
    redirect(safeNextPath(Array.isArray(next) ? next[0] : next));
  }
  return (
    <Suspense>
      <AuthForm mode="login" />
    </Suspense>
  );
}
