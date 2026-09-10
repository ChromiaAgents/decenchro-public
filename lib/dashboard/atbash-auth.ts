import "server-only";

import { getOwner } from "./auth";
import { decrypt } from "./crypto";
import { listDeploymentRows } from "./deployments";

type SdkModule = typeof import("@atbash/sdk");
let sdkPromise: Promise<SdkModule> | null = null;
function loadSdk(): Promise<SdkModule> {
  sdkPromise ??= import("@atbash/sdk");
  return sdkPromise;
}

export type AtbashAuth = { privkey: string; pubkey: string };

/**
 * Atbash gates its read API behind a signed bearer: without one, every read
 * returns 401. Every agent is deployed to its own remote host, so the console
 * has no agent key of its own on disk — it signs with an identity the
 * signed-in company already owns: the Atbash key pasted at deploy time,
 * encrypted at rest in `deployments.atbash_privkey_enc`.
 *
 * Undefined when the company has deployed nothing, in which case callers
 * degrade to empty/null rather than throwing.
 */
export async function readAuth(): Promise<AtbashAuth | undefined> {
  const key = await companyAgentKey();
  if (!key) return undefined;
  try {
    const sdk = await loadSdk();
    return { privkey: key, pubkey: sdk.derivePublicKey(key) };
  } catch {
    return undefined;
  }
}

/** The newest usable deployment key this company owns, decrypted. */
async function companyAgentKey(): Promise<string | null> {
  try {
    const owner = await getOwner();
    if (owner) {
      const rows = await listDeploymentRows(owner.companyId);
      for (const row of rows) {
        if (!row.atbash_privkey_enc) continue;
        try {
          const key = decrypt(row.atbash_privkey_enc);
          if (key.trim().length > 0) return key.trim();
        } catch {
          // Encrypted under a different ENCRYPTION_KEY — try the next row.
        }
      }
    }
  } catch {
    // fall through to the operator-level env key
  }
  // Single-tenant / self-host fallback: an operator-level Atbash agent key set
  // in the environment. Used when the company has no console-deployed agent row
  // (e.g. an agent registered outside the deploy wizard). This is the identity
  // that signs the gated Atbash reads.
  const envKey = (process.env.ATBASH_AGENT_KEY ?? "").trim();
  return envKey.length > 0 ? envKey : null;
}
