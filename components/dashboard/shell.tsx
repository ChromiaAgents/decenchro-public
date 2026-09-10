"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { signOut } from "@/lib/auth/client";
import { LogoMark } from "@/components/site/logo-mark";
import {
  environmentBanner,
  type AppEnvironment,
} from "@/lib/dashboard/environment";

import { AccountMenu } from "./account-menu";
import { HostContact } from "./host-contact";
import { DashboardNav } from "./nav";

// Persistent dashboard chrome, in the shape of a cloud console (user decision
// 2026-08-23, "I want the dashboard console look like GCP console"): a fixed top
// app bar carrying identity and account, a collapsible nav rail under it, and the
// page's own header living inside the content column.
//
// It stays in the route layout, so navigating between sections swaps only
// `children` — the bar and the rail are never unmounted and never re-fetch, which
// is half of why section changes no longer flash a skeleton.
//
// What this deliberately does NOT copy from GCP: a global search field and a
// project switcher. There is one company per owner and nothing global to search,
// so both would be chrome that does nothing. The real search lives in the Fleet
// table's own filter, where there are rows to filter.

const RAIL_KEY = "decenchro:nav-collapsed";

export function DashboardShell({
  authEnabled,
  session,
  company,
  hosted,
  environment,
  children,
}: {
  authEnabled: boolean;
  session: { user: string; role: "admin" | "viewer" };
  company?: string | null;
  hosted: boolean;
  environment: AppEnvironment;
  children: React.ReactNode;
}) {
  // Production gets no banner. Everything else gets one it cannot scroll away
  // from, which is why the offsets below are computed rather than constant.
  const banner = environmentBanner(environment);
  // Rail state is per-browser and read after mount: the server has no way to
  // know it, and rendering the collapsed rail on the server would hydrate
  // against an expanded client (the bug class that bit the nav radius).
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(RAIL_KEY) === "1");
    } catch {
      /* storage disabled — the rail just starts expanded */
    }
  }, []);
  const toggleRail = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(RAIL_KEY, next ? "1" : "0");
      } catch {
        /* best-effort */
      }
      return next;
    });
  };

  const logout = async () => {
    // Goes through lib/auth/client rather than a bare fetch. A hand-rolled POST
    // here sent `content-type: application/json` with no body, and the auth
    // server's Fastify layer rejects that with FST_ERR_CTP_EMPTY_JSON_BODY —
    // 400, no cookies cleared, so the redirect landed on /login while the
    // session was still live and the console let you straight back in.
    await signOut();
    window.location.href = "/login";
  };

  return (
    <div className="console-light min-h-screen bg-console-deep">
      {/* ── Top app bar ──────────────────────────────────────────────────
          Sticky and full-width, the way a cloud console's is: the rail starts
          below it rather than beside it, so the product identity stays put
          while everything else scrolls.

          The environment banner is INSIDE the sticky block rather than above it:
          a banner that scrolls away stops answering the question it exists for
          the moment you scroll. */}
      <div className="sticky top-0 z-30">
        {banner && (
          <div className="flex items-center justify-center gap-2.5 bg-ink px-3 py-1.5 md:px-4">
            <span className="label-micro shrink-0 rounded-full bg-accent px-2 py-0.5 text-white">
              {banner.label}
            </span>
            {/* Hidden below sm rather than truncated: a centred sentence cut off
                mid-word is worse than the label on its own, and the label is the
                part that has to be readable at a glance. */}
            <span className="hidden min-w-0 truncate font-mono text-[12px] text-white/70 sm:block">
              {banner.detail}
            </span>
          </div>
        )}
        <header className="flex h-14 items-center gap-2 border-b border-console-rule bg-console px-3 md:px-4">
        <button
          type="button"
          onClick={() => {
            setMobileOpen((o) => !o);
            if (window.matchMedia("(min-width: 768px)").matches) toggleRail();
          }}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!collapsed}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-console-mid transition-colors hover:bg-console-deep hover:text-console-ink"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
          >
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>

        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 font-sans text-[15px] font-medium tracking-[-0.01em] text-console-ink transition-colors hover:text-accent"
        >
          <LogoMark className="h-4 w-4 text-accent" />
          decenchro
        </Link>
        <span
          aria-hidden
          className="hidden h-5 w-px shrink-0 bg-console-rule sm:block"
        />
        <span className="label-micro hidden shrink-0 text-console-faint sm:block">
          console
        </span>

        {/* Company, email and sign-out used to sit loose in the bar, which made
            sign-out the most prominent control in the console and the one an
            operator wants least often. They collapse into one account trigger. */}
        {authEnabled && (
          <AccountMenu
            user={session.user}
            role={session.role}
            company={company}
            onSignOut={logout}
          />
        )}
        </header>
      </div>

      {/* Both offsets below have to account for the banner, or the rail sticks
          at the wrong height and its last item falls under the fold. The banner
          is a known 2rem, so this is arithmetic rather than measurement. */}
      <div
        className={
          banner ? "flex min-h-[calc(100vh-5.5rem)]" : "flex min-h-[calc(100vh-3.5rem)]"
        }
      >
        {/* ── Nav rail ───────────────────────────────────────────────────
            Collapses to icons on desktop; on mobile it is a disclosure above
            the content rather than an overlay, which needs no focus trap and
            cannot strand a user behind a scrim. */}
        <aside
          className={`shrink-0 border-console-rule bg-console-deep transition-[width] md:sticky md:border-r ${
            banner ? "md:top-22 md:h-[calc(100vh-5.5rem)]" : "md:top-14 md:h-[calc(100vh-3.5rem)]"
          } ${collapsed ? "md:w-14" : "md:w-56"} ${
            mobileOpen ? "w-full border-b" : "hidden md:block"
          }`}
        >
          <DashboardNav hosted={hosted} collapsed={collapsed} />
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto w-full max-w-[1200px]">
            <HostContact />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
