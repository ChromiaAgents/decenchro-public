/**
 * Copy a Supabase project's application data into a Neon database.
 *
 *   node scripts/migrate-from-supabase.mjs --project=<ref> --url=<neon-url>
 *   node scripts/migrate-from-supabase.mjs … --dry        # read and report, write nothing
 *   node scripts/migrate-from-supabase.mjs --selfcheck    # assert the row mapping, no network
 *
 * Needs SUPABASE_ACCESS_TOKEN (an sbp_… management token).
 *
 * There is no pg_dump here on purpose. The whole database is ~120 rows, and the
 * Supabase Management API will run arbitrary SQL — which sidesteps the fact that
 * db.<ref>.supabase.co resolves AAAA-only, so a direct pg_dump from an IPv4 host
 * cannot reach it without going through the session pooler and knowing the
 * database password. Neither is needed to move this much data.
 *
 * Every id and owner_id is preserved verbatim, so the deployment rows keep
 * pointing at their companies and the encrypted secret columns
 * (atbash_privkey_enc, openrouter_key_enc, telegram_token_enc, ssh_privkey_enc)
 * move as ciphertext. They stay decryptable because ENCRYPTION_KEY is unchanged
 * — that is the single most important thing to verify afterwards.
 *
 * Password hashes are NOT copied; Better Auth cannot import Supabase's bcrypt.
 * What crosses over is auth.users.email, landing in companies.owner_email, which
 * is how a user who signed up with a password is recognised when they come back
 * through Google. See db/migrations/0003_owner_email.sql.
 *
 * Safe to re-run: every insert is `on conflict (id) do nothing`.
 */
import postgres from "postgres";

// FK order. credit_ledger.deployment_id references deployments, so deployments
// must land first; cpay_events and contact_submissions are unreferenced.
const TABLES = [
  "companies",
  "deployments",
  "credit_ledger",
  "credit_payments",
  "cpay_events",
  "contact_submissions",
];

/**
 * Attach each company's owner email from auth.users.
 *
 * Kept as a pure function so --selfcheck can exercise it. A company whose owner
 * is missing from auth.users keeps a null owner_email rather than being dropped:
 * losing the row would orphan its deployments, and a null merely means that user
 * has to be re-linked by hand instead of silently signing in as someone else.
 */
export function withOwnerEmail(companies, users) {
  const byId = new Map(users.map((u) => [u.id, u.email]));
  return companies.map((c) => ({ ...c, owner_email: byId.get(c.owner_id) ?? null }));
}

function arg(name) {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function supabaseSql(ref, token, query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await res.json();
  if (!res.ok || body?.message) throw new Error(`supabase query failed: ${body?.message ?? res.status}`);
  return body;
}

if (process.argv.includes("--selfcheck")) {
  const { strict: assert } = await import("node:assert");
  const out = withOwnerEmail(
    [
      { id: "c1", owner_id: "u1" },
      { id: "c2", owner_id: "missing" },
    ],
    [{ id: "u1", email: "A@Example.com" }],
  );
  assert.equal(out.length, 2, "no company may be dropped");
  assert.equal(out[0].owner_email, "A@Example.com", "email must be copied verbatim, case included");
  assert.equal(out[1].owner_email, null, "an unmatched owner must be null, not undefined or absent");
  assert.ok("owner_email" in out[1], "the column must be present even when null");
  console.log("selfcheck ok");
  process.exit(0);
}

const ref = arg("project");
const neonUrl = arg("url") || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
const token = process.env.SUPABASE_ACCESS_TOKEN;
const dry = process.argv.includes("--dry");

if (!ref || !neonUrl || !token) {
  console.error("usage: --project=<supabase-ref> --url=<neon-url>, with SUPABASE_ACCESS_TOKEN set");
  process.exit(1);
}

const sql = postgres(neonUrl, { max: 1, prepare: !neonUrl.includes("-pooler"), idle_timeout: 5 });

const users = await supabaseSql(ref, token, "select id, email from auth.users");
console.log(`${users.length} auth user(s) — emails only, no password hashes`);

let total = 0;
for (const table of TABLES) {
  const rows = await supabaseSql(ref, token, `select * from public.${table}`);
  const mapped = table === "companies" ? withOwnerEmail(rows, users) : rows;

  if (mapped.length === 0) {
    console.log(`  ${table.padEnd(20)} 0 rows`);
    continue;
  }

  // Only carry columns the Neon table actually has. Drops the dead Supabase
  // extras rather than failing the whole table on one unknown name.
  const cols = (
    await sql`select column_name from information_schema.columns
              where table_schema = 'public' and table_name = ${table}`
  ).map((r) => r.column_name);
  const keep = Object.keys(mapped[0]).filter((k) => cols.includes(k));
  const skipped = Object.keys(mapped[0]).filter((k) => !cols.includes(k));
  const payload = mapped.map((r) => Object.fromEntries(keep.map((k) => [k, r[k]])));

  if (dry) {
    console.log(`  ${table.padEnd(20)} ${String(mapped.length).padStart(4)} rows (dry)${skipped.length ? ` skipping ${skipped.join(",")}` : ""}`);
    continue;
  }

  await sql`insert into ${sql(table)} ${sql(payload, ...keep)} on conflict (id) do nothing`;
  const [{ count }] = await sql`select count(*)::int as count from ${sql(table)}`;
  console.log(`  ${table.padEnd(20)} ${String(mapped.length).padStart(4)} read → ${count} in neon${skipped.length ? ` (skipped ${skipped.join(",")})` : ""}`);
  total += mapped.length;
}

if (!dry) {
  const [{ linked }] = await sql`select count(*)::int as linked from public.companies where owner_email is not null`;
  console.log(`\n${total} row(s) copied; ${linked} company/companies linked by email`);
}
await sql.end();
