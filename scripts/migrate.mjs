/**
 * Apply every migration in db/migrations that has not been applied yet.
 *
 *   node scripts/migrate.mjs                 # apply to $DATABASE_URL
 *   node scripts/migrate.mjs --dry           # list what would run, touch nothing
 *   node scripts/migrate.mjs --baseline      # record as applied without executing
 *   node scripts/migrate.mjs --url=postgres://…
 *
 * Ported from chromia-pay's scripts/migrate.ts. Keyed on FILENAMES, not on
 * drizzle's meta/_journal.json — the journal only knows about migrations
 * drizzle-kit generated, and the first three here were written by hand, so a
 * runner that trusted it would silently skip exactly the ones nobody has a tool
 * to double-check.
 *
 * Each file runs inside its own transaction together with its ledger row, so a
 * failure leaves the database on the last migration that fully succeeded rather
 * than halfway through one. Postgres does DDL transactionally, which is what
 * makes that possible — but it also means a migration file must not open its own
 * `begin`/`commit` (supabase/migrations/0009_render_provider.sql does; none of
 * the files here do).
 *
 * Runs on the UNPOOLED url when one is available. A transaction-mode pooler
 * hands out a different backend per statement, which breaks multi-statement DDL.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import postgres from "postgres";

const DIR = join(dirname(new URL(import.meta.url).pathname), "..", "db", "migrations");
const dry = process.argv.includes("--dry");
const baseline = process.argv.includes("--baseline");
const urlArg = process.argv.find((a) => a.startsWith("--url="))?.slice(6);

const url = urlArg || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("no database url: pass --url= or set DATABASE_URL_UNPOOLED / DATABASE_URL");
  process.exit(1);
}
if (url.includes("-pooler")) {
  console.error("refusing to migrate through the pooled endpoint — use the unpooled url");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: true, idle_timeout: 5 });
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

// Checked rather than `create table if not exists`, which emits a NOTICE that
// postgres.js prints in full. A deploy log opening with what looks like an error
// is a deploy someone stops.
const [ledger] = await sql`select to_regclass('_decenchro_migrations') is not null as present`;
if (!ledger?.present) {
  await sql`create table _decenchro_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`;
}

const done = new Set((await sql`select name from _decenchro_migrations`).map((r) => r.name));
const pending = files.filter((f) => !done.has(f));

if (pending.length === 0) {
  console.log(`up to date — ${files.length} migration(s) applied`);
  await sql.end();
  process.exit(0);
}

console.log(`${done.size} applied, ${pending.length} pending:`);
for (const f of pending) console.log(`  ${f}`);

if (dry) {
  await sql.end();
  process.exit(0);
}

if (baseline) {
  // For a database migrated by hand before this runner existed. Only correct if
  // the schema already matches.
  for (const f of pending) await sql`insert into _decenchro_migrations (name) values (${f})`;
  console.log(`\nrecorded ${pending.length} migration(s) as applied — nothing was executed`);
  await sql.end();
  process.exit(0);
}

for (const f of pending) {
  const body = readFileSync(join(DIR, f), "utf8");
  process.stdout.write(`\napplying ${f} … `);
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into _decenchro_migrations (name) values (${f})`;
    });
    console.log("ok");
  } catch (err) {
    console.log("FAILED");
    console.error(`\n${err.message}`);
    await sql.end();
    process.exit(1);
  }
}

console.log(`\napplied ${pending.length} migration(s)`);
await sql.end();
