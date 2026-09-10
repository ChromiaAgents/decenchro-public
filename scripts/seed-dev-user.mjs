/**
 * Seed a local dev workspace: one company row plus the env lines that point
 * DEV_AUTH_BYPASS at it.
 *
 *   node scripts/seed-dev-user.mjs
 *
 * Needs DATABASE_URL (or DATABASE_URL_UNPOOLED) in .env.local.
 *
 * Much smaller than the Supabase version, which had to create a real confirmed
 * auth user through the GoTrue admin API and then poll for the companies row
 * that the on_auth_user_created trigger inserted. There is no trigger and no
 * auth user to create now: DEV_AUTH_BYPASS resolves a company by
 * DEV_BYPASS_USER_ID directly, so the company row IS the fixture. Nothing here
 * touches Neon Auth, so no real credentials are minted.
 *
 * Safe to re-run: keyed on owner_id, so it reports the existing row instead of
 * inserting a second one.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

// A fixed uuid so re-running does not orphan the previous workspace and any
// deployments attached to it. Deliberately obvious, and outside the space a real
// Neon Auth user id occupies.
const DEV_USER_ID = "00000000-0000-4000-8000-00000000dead";
const DEV_EMAIL = "dev@decenchro.local";

function fromEnvFile(key) {
  try {
    const line = readFileSync(".env.local", "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${key}=`));
    return line?.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}

const url =
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.DATABASE_URL ??
  fromEnvFile("DATABASE_URL_UNPOOLED") ??
  fromEnvFile("DATABASE_URL");

if (!url) {
  console.error("! no DATABASE_URL — set it in .env.local first");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: !url.includes("-pooler"), idle_timeout: 5 });

const [row] = await sql`
  insert into public.companies (owner_id, owner_email, name, description)
  values (${DEV_USER_ID}, ${DEV_EMAIL}, ${"Dev Workspace"}, ${"Local bypass workspace"})
  on conflict (owner_id) do update set owner_email = excluded.owner_email
  returning id, name
`;

console.log(`✓ company ${row.name} (${row.id})`);
console.log("\nAdd these to .env.local:\n");
console.log("DEV_AUTH_BYPASS=1");
console.log(`DEV_BYPASS_USER_ID=${DEV_USER_ID}`);
console.log(`DEV_BYPASS_EMAIL=${DEV_EMAIL}`);

await sql.end();
