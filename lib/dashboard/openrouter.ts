import "server-only";
import fs from "node:fs/promises";

import { HERMES_ENV } from "./paths";

async function readKey(): Promise<string | null> {
  try {
    const raw = await fs.readFile(HERMES_ENV, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^OPENROUTER_API_KEY=(.+)$/.exec(line);
      if (m && m[1].trim().length > 0) return m[1].trim();
    }
    return null;
  } catch {
    return null;
  }
}

export type KeyCheck = { valid: boolean; detail?: string };

// Validate a pasted (not-yet-saved) OpenRouter key by hitting /credits. Never
// logs the key; the caller gates this to admins.
export async function validateOpenRouterKey(key: string): Promise<KeyCheck> {
  const k = key.trim();
  if (!k) return { valid: false };
  try {
    const res = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${k}` },
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) {
      return { valid: false, detail: "rejected" };
    }
    if (!res.ok) return { valid: false, detail: `http ${res.status}` };
    const body = (await res.json()) as {
      data?: { total_credits?: number; total_usage?: number };
    };
    const credits = body.data?.total_credits;
    const usage = body.data?.total_usage;
    const remaining =
      credits != null && usage != null ? credits - usage : null;
    return {
      valid: true,
      detail: remaining != null ? `$${remaining.toFixed(2)} left` : "valid",
    };
  } catch {
    return { valid: false, detail: "network error" };
  }
}

export type CreditsSummary = {
  ok: boolean;
  reason?: string;
  totalCredits?: number;
  totalUsage?: number;
};

export async function fetchCredits(): Promise<CreditsSummary> {
  const key = await readKey();
  if (!key) return { ok: false, reason: "OPENROUTER_API_KEY not set" };
  try {
    const res = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const body = (await res.json()) as {
      data?: { total_credits?: number; total_usage?: number };
    };
    return {
      ok: true,
      totalCredits: body.data?.total_credits,
      totalUsage: body.data?.total_usage,
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "fetch failed",
    };
  }
}

// Per-token USD pricing per model, used to turn token estimates into cost
// estimates. OpenRouter publishes this openly at /models — no key needed, but
// we send one if present so the request shares the agent's rate limits.
export type ModelPrice = { prompt: number; completion: number };

export async function fetchModelPricing(): Promise<{
  ok: boolean;
  reason?: string;
  prices: Record<string, ModelPrice>;
}> {
  const key = await readKey();
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: key ? { Authorization: `Bearer ${key}` } : undefined,
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}`, prices: {} };
    const body = (await res.json()) as {
      data?: {
        id?: string;
        pricing?: { prompt?: string; completion?: string };
      }[];
    };
    const prices: Record<string, ModelPrice> = {};
    for (const m of body.data ?? []) {
      if (!m.id) continue;
      const prompt = Number(m.pricing?.prompt ?? "NaN");
      const completion = Number(m.pricing?.completion ?? "NaN");
      if (Number.isFinite(prompt) && Number.isFinite(completion)) {
        prices[m.id] = { prompt, completion };
      }
    }
    return { ok: true, prices };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "fetch failed",
      prices: {},
    };
  }
}
