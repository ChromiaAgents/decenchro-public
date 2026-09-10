"use client";

import { useEffect, useRef, useState } from "react";

// Account control in the top app bar (user decision 2026-08-23, "i want like a
// stripe dashboard ui with dropdown"). One trigger in place of the three things
// that used to sit loose in the bar: the company chip, the email, and a bare
// "sign out" that was the most prominent control in the console and the one an
// operator wants least often.
//
// Deliberately NOT role="menu". That role promises arrow-key roving focus, and
// a handful of links in native tab order is both simpler and honest — claiming
// menu semantics without implementing them is worse for a screen reader than
// claiming nothing. Escape and outside-click close it; focus returns to the
// trigger, which is the part people actually notice.
//
// No shadow, 1px rule, deck radius — the panel is a surface like any other in
// here, not a floating card (DESIGN.md: elevation is not part of this material).

export function AccountMenu({
  user,
  role,
  company,
  onSignOut,
}: {
  user: string;
  role: "admin" | "viewer";
  company?: string | null;
  onSignOut: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // The trigger names the PERSON, not the company. Leading with the company put
  // a name like "test" in the bar, which reads as an environment label rather
  // than an account — and the environment now has its own banner, so the bar
  // must not compete with it. The company stays in the panel, where it is
  // information rather than a badge.
  const label = user.split("@")[0] || user;
  // Narrow at every width, so small screens get the initial alone.
  const initial = (label.trim()[0] ?? "?").toUpperCase();

  useEffect(() => {
    if (!open) return;
    // pointerdown, not click: a click listener fires after focus has already
    // moved, which made the panel close and immediately reopen when the trigger
    // itself was the thing clicked.
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      // Left true on success: the redirect is in flight and re-enabling the
      // button would invite a second sign-out against a cleared session.
      setSigningOut(false);
    }
  };

  return (
    <div ref={wrap} className="relative ml-auto shrink-0">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Account: ${user}`}
        className={`flex h-10 max-w-56 items-center gap-2 rounded-full border px-1.5 py-1 transition-colors sm:pr-2.5 ${
          open
            ? "border-accent-bright/40 bg-console-deep"
            : "border-console-rule hover:border-accent-bright/40 hover:bg-console-deep"
        }`}
      >
        <span
          aria-hidden
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-[12.5px] font-medium text-accent"
        >
          {initial}
        </span>
        <span
          className="hidden min-w-0 truncate font-mono text-[12.5px] text-console-ink sm:block"
          title={user}
        >
          {label}
        </span>
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className={`hidden h-3.5 w-3.5 shrink-0 text-console-faint transition-transform sm:block ${
            open ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Account"
          // min-w wider than the trigger so the email is not the thing that
          // decides the panel's width, right-aligned so it never leaves the
          // viewport at the edge of the bar.
          className="deck absolute right-0 top-12 z-40 w-[min(19rem,calc(100vw-1.5rem))] border border-console-rule bg-console"
        >
          <div className="border-b border-console-rule px-3.5 py-3">
            <p className="label-micro text-console-faint">Signed in as</p>
            <p
              className="mt-1.5 break-all font-mono text-[12.5px] text-console-ink"
              title={user}
            >
              {user}
            </p>
            {company && (
              <p className="mt-2 flex items-center gap-2">
                <span className="min-w-0 truncate font-sans text-[13.5px] font-medium text-console-ink">
                  {company}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-px font-mono text-[11.5px] ${
                    role === "admin"
                      ? "bg-accent-soft text-accent"
                      : "border border-console-rule text-console-faint"
                  }`}
                  title={
                    role === "admin"
                      ? "Full control: deploy, configure, manage keys"
                      : "Read-only access"
                  }
                >
                  {role}
                </span>
              </p>
            )}
            {/* One company per owner, so there is no switcher here — a dropdown
                with one entry is a control that lies about what it can do. */}
          </div>

          <button
            type="button"
            onClick={() => void signOut()}
            disabled={signingOut}
            className="flex h-11 w-full items-center gap-2.5 px-3.5 text-left font-mono text-[12.5px] text-console-mid transition-colors hover:bg-console-deep hover:text-danger disabled:opacity-50"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden
              className="h-4 w-4 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 17l5-5-5-5M20 12H9M12 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h6" />
            </svg>
            {signingOut ? "signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
