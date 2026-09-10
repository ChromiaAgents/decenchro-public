import "server-only";
import fs from "node:fs/promises";

import { readScalars, writeScalars } from "./config-rw";
import { HERMES_ENV } from "./paths";

// ─── User-facing decision space ──────────────────────────────

export type Autonomy = "ask" | "judgment" | "auto";
export type NewUsers = "approve" | "allow" | "block";
export type AuditStrictness = "strict" | "standard" | "permissive";

export type AgentConfig = {
  // The model is fixed fleet-wide (user decision 2026-08-18): one model, gpt-5.4-mini.
  // Reported so the console can show what is running, not so it can be chosen.
  model: string | null;
  autonomy: Autonomy | "unknown";
  newUsers: NewUsers | "unknown";
  audit: AuditStrictness | "custom";
  guardedTools: string;
};

const AUTONOMY_MAP: Record<Autonomy, string> = {
  ask: "manual",
  judgment: "smart",
  auto: "auto",
};

const AUTONOMY_REVERSE: Record<string, Autonomy> = {
  manual: "ask",
  smart: "judgment",
  auto: "auto",
};

const NEW_USERS_MAP: Record<NewUsers, string> = {
  approve: "pair",
  allow: "allow",
  block: "deny",
};

const NEW_USERS_REVERSE: Record<string, NewUsers> = {
  pair: "approve",
  allow: "allow",
  deny: "block",
};

// Three audit tiers. The middle one matches the default we ship after the
// read_file fix; "strict" extends to browser/code-execution; "permissive"
// drops reads.
const AUDIT_PRESETS: Record<AuditStrictness, string> = {
  strict:
    "terminal,read_file,write_file,patch,search_files,web_search,web_extract,decenchro-mem,browser_navigate,browser_click,code_execution",
  standard:
    "terminal,read_file,write_file,patch,search_files,web_search,web_extract,decenchro-mem",
  permissive: "terminal,write_file,patch,decenchro-mem",
};

// ─── Read ────────────────────────────────────────────────────

async function readEnvLine(key: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(HERMES_ENV, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = new RegExp(`^${key}=(.+)$`).exec(line);
      if (m && m[1].trim().length > 0) return m[1].trim();
    }
    return null;
  } catch {
    return null;
  }
}

function detectAudit(guarded: string | null): AgentConfig["audit"] {
  if (!guarded) return "custom";
  const norm = (s: string) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .sort()
      .join(",");
  const cur = norm(guarded);
  for (const [name, preset] of Object.entries(AUDIT_PRESETS)) {
    if (norm(preset) === cur) return name as AuditStrictness;
  }
  return "custom";
}

export async function readAgentConfig(): Promise<AgentConfig> {
  const [vals, guarded] = await Promise.all([
    readScalars([
      ["model", "default"],
      ["agent", "reasoning_effort"],
      ["approvals", "mode"],
      ["unauthorized_dm_behavior"],
    ]),
    readEnvLine("ATBASH_GUARDED_TOOLS").then(
      (v) => v ?? AUDIT_PRESETS.standard,
    ),
  ]);
  const autonomy = vals["approvals.mode"];
  const dm = vals["unauthorized_dm_behavior"];

  return {
    model: vals["model.default"],
    autonomy: autonomy && AUTONOMY_REVERSE[autonomy] ? AUTONOMY_REVERSE[autonomy] : "unknown",
    newUsers: dm && NEW_USERS_REVERSE[dm] ? NEW_USERS_REVERSE[dm] : "unknown",
    audit: detectAudit(guarded),
    guardedTools: guarded,
  };
}

// ─── Write ───────────────────────────────────────────────────

export type AgentConfigUpdate = {
  autonomy?: Autonomy;
  newUsers?: NewUsers;
  audit?: AuditStrictness;
};

export async function writeAgentConfig(upd: AgentConfigUpdate): Promise<{
  configUpdated: string[];
  envUpdated: string[];
}> {
  const scalarUpdates: Array<{ path: string[]; value: string }> = [];
  if (upd.autonomy) {
    scalarUpdates.push({
      path: ["approvals", "mode"],
      value: AUTONOMY_MAP[upd.autonomy],
    });
  }
  if (upd.newUsers) {
    scalarUpdates.push({
      path: ["unauthorized_dm_behavior"],
      value: NEW_USERS_MAP[upd.newUsers],
    });
  }

  let configUpdated: string[] = [];
  if (scalarUpdates.length > 0) {
    const res = await writeScalars(scalarUpdates);
    configUpdated = [...res.updated, ...res.appended];
  }

  const envUpdated: string[] = [];
  if (upd.audit) {
    await upsertEnvLine("ATBASH_GUARDED_TOOLS", AUDIT_PRESETS[upd.audit]);
    envUpdated.push("ATBASH_GUARDED_TOOLS");
  }

  return { configUpdated, envUpdated };
}

async function upsertEnvLine(key: string, value: string): Promise<void> {
  let raw = "";
  try {
    raw = await fs.readFile(HERMES_ENV, "utf8");
  } catch {
    // file may not exist yet
  }
  const lines = raw.length > 0 ? raw.split(/\r?\n/) : [];
  const re = new RegExp(`^${key}=`);
  const idx = lines.findIndex((l) => re.test(l));
  const newLine = `${key}=${value}`;
  if (idx >= 0) lines[idx] = newLine;
  else lines.unshift(newLine);
  await fs.writeFile(HERMES_ENV, lines.join("\n"), { mode: 0o600 });
}
