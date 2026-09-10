"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Dashboard navigation, extracted from dashboard-client.tsx when the tabs became
// real routes. Active state comes from the pathname rather than from React state,
// so a deep link, a refresh and the back button all agree with what is rendered.
//
// Shaped like a cloud console's rail (2026-08-23): grouped sections under mono
// group headings, full-height rows with a left active marker, and an icon-only
// collapsed state driven by the shell.

export type SectionId =
  | "overview"
  | "fleet"
  | "memory"
  | "atbash"
  | "billing";

type Section = {
  id: SectionId;
  label: string;
  href: string;
  /** Rail group — sections in one group share a heading. */
  group: "operate" | "observe" | "account";
};

export const SECTIONS: Section[] = [
  { id: "overview", label: "Agent", href: "/dashboard", group: "operate" },
  { id: "fleet", label: "Fleet", href: "/dashboard/fleet", group: "operate" },
  // Memory temporarily hidden (2026-07-13) — the Chromia on-chain memory module
  // is offline for this deploy. Restore by re-adding the entry here and creating
  // app/dashboard/memory/page.tsx.
  // { id: "memory", label: "Memory", href: "/dashboard/memory", group: "observe" },
  { id: "atbash", label: "Atbash", href: "/dashboard/atbash", group: "observe" },
  { id: "billing", label: "Credits", href: "/dashboard/billing", group: "account" },
];

const GROUPS: Section["group"][] = ["operate", "observe", "account"];

export function NavIcon({
  id,
  className,
}: {
  id: SectionId;
  className?: string;
}) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: `h-4 w-4 shrink-0 ${className ?? ""}`,
    "aria-hidden": true,
  };
  switch (id) {
    case "memory":
      return (
        <svg {...common}>
          <ellipse cx="12" cy="5" rx="8" ry="3" />
          <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
          <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
        </svg>
      );
    case "overview":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="7" rx="1.5" />
          <rect x="3" y="13" width="18" height="7" rx="1.5" />
          <path d="M7 7.5h.01M7 16.5h.01" />
        </svg>
      );
    case "fleet":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="8" height="8" rx="1.5" />
          <rect x="13" y="3" width="8" height="8" rx="1.5" />
          <rect x="3" y="13" width="8" height="8" rx="1.5" />
          <rect x="13" y="13" width="8" height="8" rx="1.5" />
        </svg>
      );
    case "atbash":
      return (
        <svg {...common}>
          <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "billing":
      return (
        <svg {...common}>
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <path d="M2 10h20" />
        </svg>
      );
  }
}

/** True when `href` is the section currently rendered. */
export function isActiveSection(pathname: string, href: string): boolean {
  // /dashboard must not light up for /dashboard/fleet, so the root is matched
  // exactly while the others match their subtree.
  return href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
}

export function DashboardNav({
  hosted,
  collapsed = false,
}: {
  hosted: boolean;
  collapsed?: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Dashboard sections" className="flex flex-col py-2">
      {GROUPS.map((group, gi) => {
        const items = SECTIONS.filter((s) => s.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group}>
            {/* The heading is what turns a flat list into a console rail. When
                collapsed a 0.14em-tracked label has no room in 56px, so the
                groups fall back to a hairline separator. */}
            {collapsed
              ? gi > 0 && (
                  <span aria-hidden className="mx-3 my-2 block h-px bg-console-rule" />
                )
              : (
                <span className="label-micro block px-4 pt-3 pb-1 text-console-faint">
                  {group}
                </span>
              )}
            {items.map((s) => {
              const active = isActiveSection(pathname, s.href);
              // Hosted console has no local agent — the first section is the
              // deploy form, so name it what it does.
              const label = s.id === "overview" && hosted ? "Deploy" : s.label;
              return (
                <Link
                  key={s.id}
                  href={s.href}
                  aria-current={active ? "page" : undefined}
                  title={collapsed ? label : undefined}
                  // prefetch is the other half of "no loading on navigation":
                  // the next section's payload is in flight before the click.
                  prefetch
                  className={`flex min-h-10 items-center gap-3 border-l-2 font-sans text-[13.5px] transition-colors ${
                    collapsed ? "justify-center py-2.5" : "px-4 py-2"
                  } ${
                    active
                      ? "border-accent bg-accent-soft font-medium text-accent"
                      : "border-transparent text-console-mid hover:bg-console hover:text-console-ink"
                  }`}
                >
                  <NavIcon id={s.id} className={active ? "text-accent" : ""} />
                  {!collapsed && <span className="truncate">{label}</span>}
                  {/* Atbash governance isn't live yet — flag it in the rail. */}
                  {!collapsed && s.id === "atbash" && (
                    <span className="ml-auto shrink-0 rounded-full bg-accent-soft px-1.5 py-px font-mono text-[11.5px] text-accent">
                      soon
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
