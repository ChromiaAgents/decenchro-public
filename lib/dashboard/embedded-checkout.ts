"use client";

/**
 * Chromia Pay's embedded checkout, loaded on demand.
 *
 * The payer stays on the Credits page instead of being sent to
 * pay-checkout.chromia.com and back. Chromia Pay allows this only when the
 * embedding page is the same origin as that payment's `success_url`, which holds
 * here: both are our app.
 *
 * Everything about it is best-effort. The script is third-party, so it can be
 * blocked by an extension, a CSP, or a bad day at the CDN — and a broken modal
 * must never mean a customer cannot pay. Every failure path returns false so the
 * caller falls back to the full-page redirect, which is what shipped before this
 * and still works.
 *
 * onPaid is a UI signal only. Credits are applied by the webhook
 * (/api/credits/webhook) after Chromia Pay confirms the money on chain, because
 * anything the browser can tell our server, an attacker can tell it too.
 */
type EmbedHandlers = {
  onPaid?: () => void;
  onClose?: (reason?: string) => void;
  onStatus?: (status: string) => void;
};

type ChromiaPayEmbed = {
  open: (options: { url: string } & EmbedHandlers) => void;
};

declare global {
  interface Window {
    ChromiaPay?: ChromiaPayEmbed;
  }
}

const SCRIPT_SRC = "https://pay-checkout.chromia.com/embed.js";
const LOAD_TIMEOUT_MS = 6000;

let loader: Promise<ChromiaPayEmbed | null> | null = null;

/** Load embed.js once per page. A failed load is not cached, so a retry can succeed. */
function loadEmbed(): Promise<ChromiaPayEmbed | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.ChromiaPay) return Promise.resolve(window.ChromiaPay);
  if (loader) return loader;

  loader = new Promise<ChromiaPayEmbed | null>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_SRC}"]`,
    );
    const script = existing ?? document.createElement("script");
    let settled = false;
    const finish = (value: ChromiaPayEmbed | null) => {
      if (settled) return;
      settled = true;
      if (!value) loader = null; // let a later attempt try again
      resolve(value);
    };

    // A script that never fires either event (a proxy holding the connection
    // open) would otherwise leave the button spinning forever.
    const timer = window.setTimeout(() => finish(null), LOAD_TIMEOUT_MS);
    script.addEventListener("load", () => {
      window.clearTimeout(timer);
      finish(window.ChromiaPay ?? null);
    });
    script.addEventListener("error", () => {
      window.clearTimeout(timer);
      finish(null);
    });

    if (!existing) {
      script.src = SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return loader;
}

/** Open the modal. Returns false when it could not be opened at all. */
export async function openEmbeddedCheckout(
  url: string,
  handlers: EmbedHandlers = {},
): Promise<boolean> {
  const embed = await loadEmbed();
  if (!embed?.open) return false;
  try {
    embed.open({ url, ...handlers });
    return true;
  } catch {
    return false;
  }
}
