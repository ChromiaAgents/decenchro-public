import fs from "node:fs/promises";
import path from "node:path";

import { HERMES_ENV } from "./paths";

const MANAGED = [
  "ATBASH_AGENT_KEY",
  "OPENROUTER_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_ALLOWED_USERS",
] as const;

export type ManagedKey = (typeof MANAGED)[number];

export const MANAGED_KEYS: readonly ManagedKey[] = MANAGED;

export type KeyPresence = Record<ManagedKey, "present" | "missing">;

const KEY_LINE = (key: string) => new RegExp(`^${key}=([^\\s].*)?$`);

async function readEnv(): Promise<string[]> {
  try {
    const raw = await fs.readFile(HERMES_ENV, "utf8");
    return raw.split(/\r?\n/);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function getPresence(): Promise<KeyPresence> {
  const lines = await readEnv();
  const out = {} as KeyPresence;
  for (const key of MANAGED) {
    const re = KEY_LINE(key);
    out[key] = lines.some((l) => re.test(l) && l.split("=", 2)[1]?.length > 0)
      ? "present"
      : "missing";
  }
  return out;
}

// Server-only: read the actual saved values for the requested keys. Used by the
// cloud-deploy flow so an operator who already saved keys (self-hosted, in
// ~/.hermes/.env) doesn't have to re-enter them. Returns only keys that have a
// non-empty value. On the hosted console the file doesn't exist, so this is
// empty and the operator supplies keys in the deploy form as before.
export async function getSavedValues(
  keys: readonly ManagedKey[],
): Promise<Partial<Record<ManagedKey, string>>> {
  const lines = await readEnv();
  const out: Partial<Record<ManagedKey, string>> = {};
  for (const key of keys) {
    if (!MANAGED.includes(key)) continue;
    // Last occurrence wins, matching python-dotenv's read order.
    for (const l of lines) {
      const m = l.match(new RegExp(`^${key}=(.+)$`));
      if (m && m[1].length > 0) out[key] = m[1];
    }
  }
  return out;
}

// Upsert keys without disturbing the rest of the file. If the key already
// exists (even commented), replace its line in place. Otherwise append.
export async function upsertKeys(
  updates: Partial<Record<ManagedKey, string>>,
): Promise<{ updated: ManagedKey[]; appended: ManagedKey[] }> {
  await fs.mkdir(path.dirname(HERMES_ENV), { recursive: true });
  const lines = await readEnv();
  const updated: ManagedKey[] = [];
  const appended: ManagedKey[] = [];

  for (const [keyRaw, valueRaw] of Object.entries(updates)) {
    const key = keyRaw as ManagedKey;
    const value = valueRaw?.trim();
    if (!value) continue;
    if (!MANAGED.includes(key)) continue;
    if (/[\r\n]/.test(value)) {
      throw new Error(`value for ${key} contains newline`);
    }

    const newLine = `${key}=${value}`;
    const idx = lines.findIndex((l) => new RegExp(`^${key}=`).test(l));
    if (idx >= 0) {
      lines[idx] = newLine;
      updated.push(key);
    } else {
      // Prepend rather than append — keeps ATBASH_AGENT_KEY etc. above the
      // malformed-paste block at line ~366 that trips python-dotenv.
      lines.unshift(newLine);
      appended.push(key);
    }
  }

  await fs.writeFile(HERMES_ENV, lines.join("\n"), {
    mode: 0o600,
  });
  return { updated, appended };
}
