import "server-only";

import { decrypt } from "./crypto";
import { listCompanyTelegramTokens } from "./deployments";

// Reusing a company's Telegram bot token across deploys.
//
// The deploy form has always offered "saved · leave blank to keep", but the
// only thing that could satisfy it was `~/.hermes/.env` via getSavedValues() —
// a self-hosted file. On the hosted console that file does not exist, so the
// affordance never fired and every deploy meant re-typing the token. The token
// is already stored per deployment (encrypted), so the company's own history is
// the source it should have been reading all along.
//
// The token never leaves the server. The form is told only whether one exists;
// a blank field is resolved server-side in provisionAgent.

/** A deployment that still exists is still driving its bot. */
const stillDriving = (status: string) => status !== "deleted";

// A rotated ENCRYPTION_KEY leaves old ciphertext undecryptable. That is not an
// error here — the row simply can't take part in reuse.
function plaintext(enc: string): string | null {
  try {
    const v = decrypt(enc);
    return v.trim() || null;
  } catch {
    return null;
  }
}

export type TelegramReuse = {
  /** The token to fall back to when the deploy form is left blank. */
  token: string | null;
  /**
   * Name of an agent that still holds `token`. Non-null means reuse must be
   * refused: two agents polling getUpdates with one token fight over the
   * stream, and Telegram serves each update to whichever asked last.
   */
  heldBy: string | null;
};

/** What this company can reuse on its next deploy. */
export async function telegramReuse(companyId: string): Promise<TelegramReuse> {
  const rows = await listCompanyTelegramTokens(companyId);
  for (const row of rows) {
    const token = plaintext(row.telegram_token_enc);
    if (!token) continue;
    // Newest usable token wins; a live row using that same token blocks it.
    const holder = rows.find(
      (r) => stillDriving(r.status) && plaintext(r.telegram_token_enc) === token,
    );
    return { token, heldBy: holder?.agent_name ?? null };
  }
  return { token: null, heldBy: null };
}

/** The live agent already driven by `token`, or null when it is free to use. */
export async function telegramTokenHolder(
  companyId: string,
  token: string,
): Promise<string | null> {
  const wanted = token.trim();
  if (!wanted) return null;
  const rows = await listCompanyTelegramTokens(companyId);
  const holder = rows.find(
    (r) => stillDriving(r.status) && plaintext(r.telegram_token_enc) === wanted,
  );
  return holder?.agent_name ?? null;
}
