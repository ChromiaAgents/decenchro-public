/**
 * Whether /agents is hidden on this deployment.
 *
 * Production-only kill switch while the marketplace is still being finished
 * (user decision 2026-08-20): staging keeps it, decenchro.com does not. Set
 * NEXT_PUBLIC_HIDE_MARKETPLACE=1 on the Production target and nothing else —
 * env vars on this project are per-target, so the preview build keeps showing
 * it. Delete the var and redeploy to bring it back.
 *
 * NEXT_PUBLIC_ because the nav and footer that link to it are client
 * components; the value is inlined per build, and prod and preview build
 * separately. Client-safe on purpose: no `server-only` here.
 */
export const MARKETPLACE_HIDDEN =
  process.env.NEXT_PUBLIC_HIDE_MARKETPLACE === "1";
