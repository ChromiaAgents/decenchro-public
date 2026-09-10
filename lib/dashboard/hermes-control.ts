import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import {
  DASHBOARD_LOG,
  HERMES_DIR,
  RUNTIME_DIR,
} from "./paths";

// Hermes maintains its own pidfile at ~/.hermes/gateway.pid (JSON, includes
// `argv` and `kind`). Reading it directly avoids pid-mismatch issues caused by
// the bash → python wrapper layer.
const HERMES_PIDFILE = path.join(HERMES_DIR, "gateway.pid");

export type LaunchStatus =
  | { state: "stopped" }
  | { state: "running"; pid: number; argv?: string[]; startedAt?: string };

type HermesPidEntry = {
  pid?: number;
  kind?: string;
  argv?: string[];
};

async function pidAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readHermesPidfile(): Promise<HermesPidEntry | null> {
  try {
    const raw = await fs.readFile(HERMES_PIDFILE, "utf8");
    const parsed = JSON.parse(raw) as HermesPidEntry;
    return parsed;
  } catch {
    return null;
  }
}

// Hermes one-shot commands (restart, list, install, …) also write the pidfile
// and leave it as the last writer. Treat only `hermes gateway run` / `start`
// pids as the "gateway" — others are noise.
function isLongRunningArgv(argv: readonly string[] | undefined): boolean {
  if (!argv || argv.length < 3) return true; // be permissive when we don't know
  const sub = argv[2];
  return sub === "run" || sub === "start";
}

export async function getStatus(): Promise<LaunchStatus> {
  const entry = await readHermesPidfile();
  if (!entry?.pid) return { state: "stopped" };
  if (!(await pidAlive(entry.pid))) return { state: "stopped" };
  if (!isLongRunningArgv(entry.argv)) return { state: "stopped" };
  let startedAt: string | undefined;
  try {
    const stat = await fs.stat(HERMES_PIDFILE);
    startedAt = stat.mtime.toISOString();
  } catch {
    // ignore
  }
  return { state: "running", pid: entry.pid, argv: entry.argv, startedAt };
}

export async function launch(): Promise<LaunchStatus> {
  const current = await getStatus();
  if (current.state === "running") return current;

  await fs.mkdir(RUNTIME_DIR, { recursive: true });

  const fd = await fs.open(DASHBOARD_LOG, "a");
  // --replace clears any stale gateway.pid before starting. Without it, a
  // crashed previous run leaves Hermes refusing to launch.
  const child = spawn("hermes", ["gateway", "run", "--replace"], {
    detached: true,
    stdio: ["ignore", fd.fd, fd.fd],
    env: { ...process.env, HERMES_ACCEPT_HOOKS: "1" },
  });
  child.unref();
  await fd.close();

  if (!child.pid) throw new Error("failed to spawn hermes gateway");

  // Poll up to ~8s for Hermes to write its pidfile + flip to a long-running
  // argv. The UI also polls every 5s, but the user clicking Launch expects
  // immediate feedback.
  for (let i = 0; i < 32; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const after = await getStatus();
    if (after.state === "running") return after;
  }
  return { state: "stopped" };
}

export type StopOutcome =
  | { ok: true; status: LaunchStatus }
  | { ok: false; reason: string; status: LaunchStatus };

export async function stop(): Promise<StopOutcome> {
  const current = await getStatus();
  if (current.state === "stopped") return { ok: true, status: current };

  try {
    process.kill(current.pid, "SIGTERM");
  } catch (err) {
    return {
      ok: false,
      reason:
        err instanceof Error
          ? err.message
          : "kill failed (process owned by another user?)",
      status: current,
    };
  }

  // Wait for the process to actually exit, up to ~3s.
  for (let i = 0; i < 30; i++) {
    if (!(await pidAlive(current.pid))) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { ok: true, status: await getStatus() };
}

export async function tailLog(maxBytes = 8 * 1024): Promise<string> {
  try {
    const stat = await fs.stat(DASHBOARD_LOG);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = await fs.open(DASHBOARD_LOG, "r");
    const buf = Buffer.alloc(stat.size - start);
    await fd.read(buf, 0, buf.length, start);
    await fd.close();
    return buf.toString("utf8");
  } catch {
    return "";
  }
}

export const launchLogPath = DASHBOARD_LOG;
