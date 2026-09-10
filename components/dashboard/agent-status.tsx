"use client";

import type { ManagedAgent } from "@/lib/dashboard/deployments";

// Small presentational helpers shared by the agent surfaces (overview fleet
// cards, memory agent-picker). Kept separate from any one view so they don't
// pull a whole tab's worth of code along with them.

// Status → colour, shared by the Fleet and Analytics agent cards. AWS-style:
// green settled running, grey settled stopped, red failed, pulsing dot for
// anything in transition (pending/provisioning/starting/stopping).
export function managedTone(status: ManagedAgent["status"]): {
  dot: string;
  label: string;
} {
  switch (status) {
    case "running":
      return { dot: "bg-signal", label: "running" };
    case "provisioning":
    case "pending":
      return { dot: "bg-accent-bright animate-pulse", label: "provisioning" };
    case "starting":
      return { dot: "bg-signal animate-pulse", label: "starting" };
    case "stopping":
      return { dot: "bg-console-rule animate-pulse", label: "stopping" };
    case "stopped":
      return { dot: "bg-console-rule", label: "stopped" };
    case "failed":
      return { dot: "bg-warn", label: "failed" };
    default:
      return { dot: "bg-console-rule", label: status };
  }
}

// The metric cell that used to live here is now `Meta` in ./ui.tsx, alongside
// the rest of the shared console primitives. This file keeps the status
// helpers, which are logic rather than markup.

// Last-activity liveness: a status dot colour + label from an ISO timestamp.
export function liveness(iso: string | null): { dot: string; label: string } {
  if (!iso) return { dot: "bg-console-rule", label: "unknown" };
  const age = Date.now() - Date.parse(iso);
  if (age < 5 * 60_000) return { dot: "bg-signal", label: "active" };
  if (age < 24 * 60 * 60_000) return { dot: "bg-warn", label: "idle" };
  return { dot: "bg-console-rule", label: "dormant" };
}

/**
 * How long this agent has been up, in minutes, or null when there is no honest
 * answer to give.
 *
 * Counts from `startedAt` — the moment the agent reported ready, or was resumed
 * — NOT from `createdAt`, which is when the operator pressed Deploy and so
 * includes the whole provisioning window (75s on a good Render deploy, minutes
 * on a bad one) plus, for a paused-and-resumed agent, all the time it spent off.
 * `createdAt` is the fallback for rows written before migration 0004, where it
 * is the only start we have.
 *
 * A live agent counts to now; a stopped one counts to its last heartbeat. When a
 * stopped agent has NO heartbeat this returns null rather than counting to now:
 * that is a deploy that never came up, and the old code showed its "uptime"
 * growing forever — the exact thing its own comment said it was avoiding.
 *
 * Shared with the fleet table's sort so the number a row is ordered by is the
 * number it displays; they were two copies of this arithmetic before.
 */
export function uptimeMinutes(m: ManagedAgent): number | null {
  // A provisioning agent has no uptime yet — it is not up. Without this the
  // createdAt fallback below starts counting the moment Deploy is pressed, so a
  // deploy still pulling its image reports minutes of uptime. Provisioning time
  // is its own figure; see provisioningSeconds().
  if (m.status === "provisioning" || m.status === "pending") return null;
  const started = Date.parse(m.startedAt ?? m.createdAt);
  if (!Number.isFinite(started)) return null;
  const live = m.status === "running" || m.status === "starting";
  const seen = m.lastSeen ? Date.parse(m.lastSeen) : NaN;
  if (!live && !Number.isFinite(seen)) return null;
  const end = live ? Date.now() : seen;
  return Math.max(0, Math.round((end - started) / 60_000));
}

/**
 * How long this agent took to provision, in seconds, or null when unknowable.
 *
 * created_at is when Deploy was pressed and started_at is when the agent
 * reported ready, so the gap between them is the wait an operator actually sat
 * through: Render creating the service, pulling the image, booting the container
 * and passing its first health check. Worth surfacing because it is the number
 * the image slimming moved (109s -> 75s measured), and because a deploy that
 * took five minutes is worth noticing even though it succeeded.
 *
 * While still provisioning it counts up from created_at, so the card can show
 * the wait as it happens. Null for a row with no started_at that is no longer
 * provisioning: either it predates migration 0004 or it never came up, and both
 * are honestly unknown rather than zero.
 */
export function provisioningSeconds(m: ManagedAgent): number | null {
  const created = Date.parse(m.createdAt);
  if (!Number.isFinite(created)) return null;
  if (m.status === "provisioning" || m.status === "pending")
    return Math.max(0, Math.round((Date.now() - created) / 1000));
  if (!m.startedAt) return null;
  const started = Date.parse(m.startedAt);
  if (!Number.isFinite(started)) return null;
  return Math.max(0, Math.round((started - created) / 1000));
}

/** `provisioningSeconds` as a compact label: 45s, 1m 15s, or — when unknown. */
export function provisioningLabel(m: ManagedAgent): string {
  const secs = provisioningSeconds(m);
  if (secs === null) return "—";
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`;
}

/** `uptimeMinutes` as a compact label: 7m, 3h 12m, 2d 4h, or — when unknown. */
export function uptime(m: ManagedAgent): string {
  const mins = uptimeMinutes(m);
  if (mins === null) return "—";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ${mins % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

// Compact relative time ("just now", "12m ago", "3h ago", "2d ago").
export function relative(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const m = Math.floor((Date.now() - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// A tiny safe/caution/blocked verdict bar with counts.
export function PostureMini({
  v,
}: {
  v: { green: number; yellow: number; red: number };
}) {
  const total = v.green + v.yellow + v.red;
  if (total === 0) {
    return <span className="font-mono text-[12px] text-console-faint">—</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-1.5 w-16 overflow-hidden rounded-full bg-console-rule">
        {v.green > 0 && (
          <span className="bg-signal" style={{ width: `${(v.green / total) * 100}%` }} />
        )}
        {v.yellow > 0 && (
          <span className="bg-warn" style={{ width: `${(v.yellow / total) * 100}%` }} />
        )}
        {v.red > 0 && (
          <span className="bg-danger" style={{ width: `${(v.red / total) * 100}%` }} />
        )}
      </div>
      <span className="font-mono text-[12px] tabular-nums text-console-faint">
        {v.green}/{v.yellow}/{v.red}
      </span>
    </div>
  );
}

// One runnable check for the uptime arithmetic, the only non-trivial logic in
// this file. Run: npx tsx components/dashboard/agent-status.tsx
export function demo(): void {
  const a = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`agent-status self-check failed: ${msg}`);
  };
  const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
  const MIN = 60_000;
  const agent = (over: Partial<ManagedAgent>): ManagedAgent =>
    ({
      status: "running",
      createdAt: iso(60 * MIN),
      startedAt: null,
      lastSeen: null,
      ...over,
    }) as ManagedAgent;

  // The bug this was written for: provisioning must not be inside the number.
  // Created an hour ago, live for ten minutes → ten, not sixty.
  a(
    uptimeMinutes(agent({ startedAt: iso(10 * MIN) })) === 10,
    "a live agent counts from startedAt, not createdAt",
  );
  // Pre-0004 rows have no startedAt, so createdAt is the only start there is.
  a(
    uptimeMinutes(agent({ startedAt: null })) === 60,
    "no startedAt falls back to createdAt",
  );
  // A stopped agent freezes at its last heartbeat instead of counting forward.
  a(
    uptimeMinutes(
      agent({ status: "stopped", startedAt: iso(50 * MIN), lastSeen: iso(20 * MIN) }),
    ) === 30,
    "a stopped agent counts to its last heartbeat",
  );
  // The other bug: a deploy that never reported has no uptime to show, and used
  // to show one that grew forever.
  a(
    uptimeMinutes(agent({ status: "failed", lastSeen: null })) === null,
    "no heartbeat and not live is unknown, not now-minus-start",
  );
  a(uptime(agent({ status: "failed", lastSeen: null })) === "—", "unknown renders as a dash");
  // Provisioning is not uptime. This is the case the createdAt fallback got
  // wrong: an agent still pulling its image reported the age of its row.
  for (const status of ["provisioning", "pending"] as const) {
    a(uptimeMinutes(agent({ status })) === null, `${status} has no uptime`);
    a(uptime(agent({ status })) === "—", `${status} renders a dash`);
  }

  // Provisioning duration: the gap between the two timestamps once it is up,
  // and a live count while it is not.
  a(
    provisioningSeconds(
      agent({ createdAt: iso(10 * MIN), startedAt: iso(9 * MIN) }),
    ) === 60,
    "provisioning is startedAt minus createdAt",
  );
  a(provisioningLabel(agent({ createdAt: iso(10 * MIN), startedAt: iso(9 * MIN) })) === "1m 00s",
    "a minute-plus wait is padded");
  a(provisioningLabel(agent({ createdAt: iso(45_000), startedAt: iso(0) })) === "45s",
    "under a minute is seconds");
  a(
    (provisioningSeconds(agent({ status: "provisioning", createdAt: iso(30_000) })) ?? 0) >= 29,
    "a provisioning agent counts up from createdAt",
  );
  a(
    provisioningSeconds(agent({ status: "failed", startedAt: null })) === null,
    "a deploy that never came up has no provisioning time to report",
  );
  a(
    provisioningSeconds(agent({ status: "running", startedAt: null })) === null,
    "a pre-0004 row is unknown rather than zero",
  );

  // "starting" is live for billing (metering.ts LIVE), so it is live here too.
  a(
    uptimeMinutes(agent({ status: "starting", startedAt: iso(5 * MIN) })) === 5,
    "starting counts as up, matching what metering bills",
  );
  // Clock skew must not produce a negative duration.
  a(
    uptimeMinutes(agent({ startedAt: new Date(Date.now() + 5 * MIN).toISOString() })) === 0,
    "a start in the future clamps to zero",
  );
  a(uptimeMinutes(agent({ startedAt: "not-a-date", createdAt: "also-not" })) === null,
    "an unparseable start is unknown");
  // Formatting boundaries.
  a(uptime(agent({ startedAt: iso(59 * MIN) })) === "59m", "under an hour is minutes");
  a(uptime(agent({ startedAt: iso(60 * MIN) })) === "1h 0m", "an hour rolls over");
  a(uptime(agent({ startedAt: iso(25 * 60 * MIN) })) === "1d 1h", "a day rolls over");

  console.log("agent-status self-check ok");
}

if (
  typeof process !== "undefined" &&
  import.meta.url === `file://${process.argv?.[1]}`
)
  demo();
