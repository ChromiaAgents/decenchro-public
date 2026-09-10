import "server-only";
import fs from "node:fs/promises";

import { HERMES_ENV } from "./paths";

async function readBotToken(): Promise<string | null> {
  try {
    const raw = await fs.readFile(HERMES_ENV, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^TELEGRAM_BOT_TOKEN=(.+)$/.exec(line);
      if (m && m[1].trim().length > 0) return m[1].trim();
    }
    return null;
  } catch {
    return null;
  }
}

export type TokenCheck = { valid: boolean; detail?: string };

// Validate a pasted (not-yet-saved) bot token via getMe; returns the bot's
// @handle on success. Never logs the token; the caller gates this to admins.
export async function validateBotToken(token: string): Promise<TokenCheck> {
  const t = token.trim();
  if (!t) return { valid: false };
  try {
    const res = await fetch(`https://api.telegram.org/bot${t}/getMe`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return { valid: false, detail: res.status === 401 ? "rejected" : `http ${res.status}` };
    }
    const body = (await res.json()) as {
      ok: boolean;
      result?: { username?: string };
    };
    if (!body.ok || !body.result?.username) {
      return { valid: false, detail: "bad token" };
    }
    return { valid: true, detail: `@${body.result.username}` };
  } catch {
    return { valid: false, detail: "network error" };
  }
}

export type BotInfo =
  | { ok: true; username: string; firstName: string; id: number }
  | { ok: false; reason: string };

let cache: { token: string; info: BotInfo; at: number } | null = null;
const TTL = 60_000;

export async function fetchBotInfo(): Promise<BotInfo> {
  const token = await readBotToken();
  if (!token) return { ok: false, reason: "TELEGRAM_BOT_TOKEN not set" };
  if (cache && cache.token === token && Date.now() - cache.at < TTL) {
    return cache.info;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      cache: "no-store",
    });
    if (!res.ok) {
      const info: BotInfo = { ok: false, reason: `HTTP ${res.status}` };
      cache = { token, info, at: Date.now() };
      return info;
    }
    const body = (await res.json()) as {
      ok: boolean;
      result?: { username?: string; first_name?: string; id?: number };
    };
    if (!body.ok || !body.result?.username || !body.result.id) {
      const info: BotInfo = { ok: false, reason: "bad response" };
      cache = { token, info, at: Date.now() };
      return info;
    }
    const info: BotInfo = {
      ok: true,
      username: body.result.username,
      firstName: body.result.first_name ?? body.result.username,
      id: body.result.id,
    };
    cache = { token, info, at: Date.now() };
    return info;
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "fetch failed" };
  }
}
