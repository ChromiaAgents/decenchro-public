import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LogoMark } from "@/components/site/logo-mark";
import { MARKETPLACE_HIDDEN } from "@/lib/marketplace/visibility";

// The marketplace wears its own slim shell rather than the marketing chrome:
// it is a public directory, closer to the console's instrument style. Light
// canvas, hairline rules, sharp panels, one teal accent; pills are the only
// rounded element (globals.css tokens throughout).

export const metadata: Metadata = {
  title: "Agent marketplace · Decenchro",
  description:
    "Discover and hire ERC-8004 agents on BNB Smart Chain. Agents deployed on Decenchro carry a tamper-proof record of everything they do.",
};

export default function AgentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Gated here rather than per page, so the listing, every detail route and
  // anything added later are covered by one check.
  if (MARKETPLACE_HIDDEN) notFound();

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      <header className="sticky top-0 z-40 border-b border-rule bg-canvas/90 backdrop-blur-sm">
        <div className="mx-auto flex h-12 w-full max-w-[1200px] items-center gap-4 px-5 md:px-10">
          <Link
            href="/"
            className="flex items-center gap-2 text-[14.5px] font-medium tracking-[-0.01em] text-ink transition-colors hover:text-accent"
          >
            <LogoMark className="h-4 w-4 text-accent" />
            decenchro
          </Link>
          <span
            aria-hidden
            className="hidden h-4 w-px bg-rule-strong sm:block"
          />
          <Link
            href="/agents"
            className="hidden whitespace-nowrap font-mono text-[12px] uppercase tracking-[0.14em] text-ink-soft transition-colors hover:text-ink sm:block"
          >
            Agent marketplace
          </Link>
          <Link
            href="/dashboard"
            className="ml-auto whitespace-nowrap font-mono text-[12px] uppercase tracking-[0.14em] text-ink-soft transition-colors hover:text-accent"
          >
            Console <span aria-hidden>&rarr;</span>
          </Link>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-8 font-mono text-[12px] text-ink-faint md:px-10">
          <span>
            © {new Date().getFullYear()} decenchro · decentralised and auditable
            agents on Chromia
          </span>
          <span className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/" className="transition-colors hover:text-ink">
              home
            </Link>
            <Link href="/pricing" className="transition-colors hover:text-ink">
              pricing
            </Link>
            <a
              href="https://8004scan.io"
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="transition-colors hover:text-ink"
            >
              8004scan
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
