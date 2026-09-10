import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Postgres connection for the control plane. Ported from chromia-pay's
 * packages/db/src/client.ts, minus its advisory-lock pool — nothing here takes
 * an advisory lock, so the second pool that exists to keep locks off the data
 * pool has no job.
 *
 * Held on globalThis, not just in module scope: a dev server re-imports this
 * module on every hot reload, and a module-scoped pool would be abandoned rather
 * than closed each time — connections the database still counts. That exhausts a
 * pooler within a few edits, and the symptom is every page suddenly returning
 * 500 with "max clients reached".
 */
const GLOBAL = globalThis as typeof globalThis & {
  __decenchroPool?: ReturnType<typeof postgres>;
  __decenchroDb?: Db;
};

let conn: ReturnType<typeof postgres> | null = GLOBAL.__decenchroPool ?? null;
let instance: Db | null = GLOBAL.__decenchroDb ?? null;

/**
 * Is this connection string pointed at a transaction-mode pooler?
 *
 * This decides whether prepared statements can be used at all. Transaction mode
 * hands a different backend connection to every statement, so a PREPARE issued
 * on one and EXECUTEd on another fails with "prepared statement does not exist".
 * postgres.js prepares by default, so pointing it at a pooler without this
 * breaks every query — not at connect time, but on the *second* use of any given
 * statement, which is why it presents as an intermittent database fault rather
 * than a configuration mistake.
 *
 * Two conventions, because hosts advertise their poolers differently:
 *
 *  - **`-pooler` in the hostname** — Neon, which serves PgBouncer on the *same*
 *    port 5432 as its direct endpoint. Only the host distinguishes them, so a
 *    port check alone reads Neon's pooler as a direct connection.
 *  - **Port 6543** — Supabase's transaction pooler. Kept for the migration
 *    window and for anyone still pointing a local .env at Supabase.
 *
 * Detected rather than configured: a flag and a URL out of step produce exactly
 * that intermittent error instead of a settings mistake anyone would recognise.
 */
export function isTransactionPooler(url: string): boolean {
  try {
    const u = new URL(url);
    return u.port === "6543" || u.hostname.includes("-pooler");
  } catch {
    return false;
  }
}

/** True when a database URL is present. Keeps local dev tolerant, as supabaseConfigured() did. */
export function dbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED);
}

function dataUrl(): string {
  // The Vercel Neon store injects DATABASE_URL already pointed at the pooled
  // endpoint, which is what ordinary queries want: it multiplexes far more
  // clients onto the same backends than the direct endpoint will hold.
  const url = process.env.DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

export function db(): Db {
  if (instance) return instance;
  const url = dataUrl();
  conn = postgres(url, {
    max: Number(process.env.DB_POOL_MAX ?? 5),
    prepare: !isTransactionPooler(url),
    // Give connections back when idle. A pool that never releases anything
    // permanently owns its share of a capped tenant, and several serverless
    // instances plus a dev server that restarts often will exhaust it.
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    // credit_ledger.delta / balance_after are money. Keep bigints as bigints on
    // the wire; the schema maps them back to numbers.
    types: { bigint: postgres.BigInt },
  });
  instance = drizzle(conn, { schema });
  GLOBAL.__decenchroPool = conn;
  GLOBAL.__decenchroDb = instance;
  return instance;
}

/** Escape hatch for raw SQL (the credit_apply() call, health checks). */
export function rawSql() {
  if (!conn) db();
  return conn!;
}
