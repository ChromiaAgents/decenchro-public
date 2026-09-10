"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";


// "Contact us" as a modal form (Name / Company / Email / Questions) that posts
// to /api/contact, which emails the submission to the support inbox. Replaces
// the old mailto links so it works without a mail client and captures leads
// server-side. Reused on the marketing pricing page and the dashboard Credits tab.
//
// Styled in Tailwind rather than the .dh-* classes the rest of components/site
// uses: home.css is imported by the (site) layout and app/page.tsx only, so on
// the dashboard those classes resolve to nothing and the modal rendered as bare
// unstyled markup. Tailwind is in the root layout, so it reaches both trees.
//
// It also uses the light palette directly rather than the console tokens: the
// modal portals into document.body, so it falls outside the dashboard's
// .console-light scope and would keep whatever the tokens say globally.

type Status = "idle" | "sending" | "sent" | "error";

const SUBMIT =
  "inline-flex min-h-[44px] items-center gap-3.5 whitespace-nowrap rounded-full bg-accent px-[18px] py-3.5 font-mono text-[14px] uppercase tracking-[0.05em] text-canvas transition-colors hover:bg-ink disabled:opacity-50";

const LABEL =
  "block font-mono text-[11px] uppercase tracking-[0.12em] text-ink-soft";
// Value + placeholder are prose, so force the sans stack — otherwise inputs
// inherit the app's mono font and typed names/questions read like terminal text.
const INPUT =
  "mt-[7px] w-full rounded-[10px] border border-rule-strong bg-paper px-[13px] py-[11px] font-sans text-[14px] text-ink normal-case tracking-normal transition-colors placeholder:text-ink-faint focus:border-accent focus:outline-none";

export function ContactButton({
  label = "Contact us",
  subject,
  variant = "accent",
  arrow = false,
  className,
}: {
  label?: string;
  // Prefills the email subject so triage knows where the lead came from.
  subject?: string;
  variant?: "primary" | "accent" | "bright";
  arrow?: boolean;
  // Override the pill styling (e.g. the dashboard's outline button).
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const cls = className ?? "dh-btn";
  return (
    <>
      <button type="button" className={cls} onClick={() => setOpen(true)}>
        {label}
        {arrow && (
          <span className="font-mono text-[11px] opacity-70 transition-transform group-hover:translate-x-0.5">
            &rarr;
          </span>
        )}
      </button>
      {open && <ContactModal subject={subject} onClose={() => setOpen(false)} />}
    </>
  );
}

function ContactModal({
  subject,
  onClose,
}: {
  subject?: string;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  // Portal only after mount (document exists client-side). Without the portal
  // the modal renders inside the dashboard's framer-motion wrapper, whose
  // transform makes `position: fixed` relative to that box — so it centers on
  // the tab panel, not the viewport, and its top gets clipped off-screen.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Close on Escape — standard modal affordance.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setStatus("sending");
    setError(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: String(data.get("name") ?? ""),
          company: String(data.get("company") ?? ""),
          email: String(data.get("email") ?? ""),
          message: String(data.get("message") ?? ""),
          website: String(data.get("website") ?? ""), // honeypot
          subject,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Try again.");
        setStatus("error");
        return;
      }
      setStatus("sent");
    } catch {
      setError("Network error. Try again.");
      setStatus("error");
    }
  };

  if (!mounted) return null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#131311]/45 px-4 py-6 backdrop-blur-[6px]"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Contact us"
        className="max-h-[90vh] w-full max-w-[420px] overflow-auto rounded-2xl border border-rule bg-canvas p-[26px]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="mb-1.5 font-display text-[24px] font-semibold tracking-[-0.015em] text-ink">
              Talk to us
            </h2>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink-body">
              Tell us what you need and we will get back to you.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink-soft transition-colors hover:text-ink"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {status === "sent" ? (
          <div className="mt-6 rounded-xl border border-accent/30 bg-accent-soft/50 px-4 py-6 text-center">
            <p className="text-[16px] font-medium text-ink">
              Thanks, we got it.
            </p>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink-body">
              We will reply to the email you gave us.
            </p>
            <button
              type="button"
              onClick={onClose}
              className={SUBMIT}
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-4">
            {/* Honeypot — hidden from humans, catches bots that fill everything. */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="hidden"
            />
            <label className={LABEL}>
              Name
              <input
                name="name"
                required
                autoComplete="name"
                placeholder="Your name"
                className={INPUT}
              />
            </label>
            <label className={LABEL}>
              Company{" "}
              <span className="lowercase tracking-normal text-ink-faint">
                (optional)
              </span>
              <input
                name="company"
                autoComplete="organization"
                placeholder="Where you work"
                className={INPUT}
              />
            </label>
            <label className={LABEL}>
              Email
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@company.com"
                className={INPUT}
              />
            </label>
            <label className={LABEL}>
              Questions
              <textarea
                name="message"
                required
                rows={4}
                placeholder="What can we help with?"
                className={`${INPUT} resize-y`}
              />
            </label>

            {status === "error" && error && (
              <p className="text-[13px] leading-snug text-warn-ink">{error}</p>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={status === "sending"}
                className={SUBMIT}
              >
                {status === "sending" ? "Sending…" : "Send"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-[40px] items-center px-1 text-[13px] text-ink-soft transition-colors hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </motion.div>
    </motion.div>,
    document.body,
  );
}
