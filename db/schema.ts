import {
  bigint,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Drizzle mirror of db/migrations. Introspected from the live database with
 * `drizzle-kit pull`, then rewritten to keep the **snake_case column names as
 * the TypeScript property names**.
 *
 * That is deliberate and load-bearing. drizzle-kit camelCases by default, which
 * would have renamed every field on DeploymentRow (company_id → companyId, and
 * 30 more) and forced an edit in every dashboard component, API route and
 * lib/dashboard module that reads a row. Keeping the database's own names means
 * `typeof deployments.$inferSelect` is assignable to the DeploymentRow shape the
 * app already passes around, so the query rewrite stops at the data layer.
 *
 * `mode` choices match what PostgREST used to hand back, so consumers see the
 * same JavaScript types as before: timestamps as ISO strings, numeric and bigint
 * as numbers.
 */

export const companies = pgTable(
  "companies",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    owner_id: uuid().notNull().unique(),
    // The Neon Auth bridge. Null only for a company whose Supabase user was
    // already gone at migration time; see db/migrations/0003_owner_email.sql.
    owner_email: text(),
    name: text().notNull(),
    description: text().default("").notNull(),
    created_at: timestamp({ withTimezone: true, mode: "string" }).defaultNow().notNull(),
    updated_at: timestamp({ withTimezone: true, mode: "string" }).defaultNow().notNull(),
    // Dead Stripe columns from the retired metered-billing attempt.
    stripe_customer_id: text(),
    stripe_subscription_id: text(),
    subscription_status: text(),
    metered_usd_reported: numeric({ mode: "number" }).default(0).notNull(),
    metered_month: text(),
    plan: text(),
    credit_balance: bigint({ mode: "number" }).default(0).notNull(),
  },
  (t) => [
    uniqueIndex("companies_owner_email_key").on(sql`lower(${t.owner_email})`),
    check("companies_name_check", sql`char_length(trim(${t.name})) between 1 and 120`),
    check("companies_description_check", sql`char_length(${t.description}) <= 2000`),
  ],
);

export const deployments = pgTable(
  "deployments",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    company_id: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    // No longer a foreign key: identity lives in Neon Auth's own schema.
    owner_id: uuid().notNull(),
    agent_name: text().default("agent").notNull(),
    atbash_pubkey: text().notNull(),
    model_id: text().default("").notNull(),
    server_type: text().default("cx22").notNull(),
    atbash_privkey_enc: text().notNull(),
    openrouter_key_enc: text().notNull(),
    telegram_token_enc: text().notNull(),
    telegram_allowed_users: text().default("").notNull(),
    soul_md: text().default("").notNull(),
    // Read-only shims for rows created before migration 0009.
    hetzner_server_id: bigint({ mode: "number" }),
    hetzner_server_ip: text(),
    hetzner_ssh_key_id: bigint({ mode: "number" }),
    ssh_privkey_enc: text(),
    status: text().default("pending").notNull(),
    provision_phase: integer().default(0).notNull(),
    last_seen: timestamp({ withTimezone: true, mode: "string" }),
    fail_reason: text(),
    created_at: timestamp({ withTimezone: true, mode: "string" }).defaultNow().notNull(),
    updated_at: timestamp({ withTimezone: true, mode: "string" }).defaultNow().notNull(),
    provider: text().default("hetzner").notNull(),
    monthly_budget_usd: numeric({ mode: "number" }),
    expires_at: timestamp({ withTimezone: true, mode: "string" }),
    category_id: text().default("general").notNull(),
    provider_service_id: text(),
    agent_endpoint: text(),
    metered_until: timestamp({ withTimezone: true, mode: "string" }),
    // When the agent last entered running state. Distinct from created_at,
    // which is when the row was inserted and so includes provisioning.
    started_at: timestamp({ withTimezone: true, mode: "string" }),
    llm_cost_billed: numeric({ mode: "number" }).default(0).notNull(),
    erc8004_agent_id: bigint({ mode: "number" }),
    erc8004_tx: text(),
    bsc_address: text(),
    erc8004_chain_id: integer(),
    erc8004_attested_at: timestamp({ withTimezone: true, mode: "string" }),
  },
  (t) => [
    index("deployments_company_idx").on(t.company_id),
    index("deployments_pubkey_idx").on(t.atbash_pubkey),
    check(
      "deployments_status_check",
      sql`${t.status} in ('pending','provisioning','running','starting','stopping','stopped','failed','deleted')`,
    ),
    // Still accepts the retired VM providers: narrowing it would reject every
    // historical row on its next update. Pinned by scripts/check-retired-providers.mjs.
    check("deployments_provider_check", sql`${t.provider} in ('hetzner','digitalocean','render')`),
  ],
);

export const contact_submissions = pgTable("contact_submissions", {
  id: uuid().defaultRandom().primaryKey().notNull(),
  name: text().notNull(),
  company: text(),
  email: text().notNull(),
  message: text().notNull(),
  subject: text(),
  created_at: timestamp({ withTimezone: true, mode: "string" }).defaultNow().notNull(),
});

export const credit_ledger = pgTable(
  "credit_ledger",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    company_id: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    delta: bigint({ mode: "number" }).notNull(),
    balance_after: bigint({ mode: "number" }).notNull(),
    kind: text().notNull(),
    deployment_id: uuid().references(() => deployments.id, { onDelete: "set null" }),
    ref: text(),
    note: text(),
    created_at: timestamp({ withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (t) => [
    index("credit_ledger_company_idx").on(t.company_id, t.created_at.desc()),
    // The idempotency key credit_apply() leans on.
    uniqueIndex("credit_ledger_kind_ref_key").on(t.kind, t.ref),
    check(
      "credit_ledger_kind_check",
      sql`${t.kind} in ('grant','topup','runtime','llm','adjustment')`,
    ),
  ],
);

export const credit_payments = pgTable(
  "credit_payments",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    company_id: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    cpay_payment_id: text().unique(),
    pack_id: text().notNull(),
    credits: bigint({ mode: "number" }).notNull(),
    amount_usd: numeric({ mode: "number" }).notNull(),
    settlement_asset: text().notNull(),
    status: text().default("created").notNull(),
    created_at: timestamp({ withTimezone: true, mode: "string" }).defaultNow().notNull(),
    updated_at: timestamp({ withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (t) => [
    index("credit_payments_company_idx").on(t.company_id, t.created_at.desc()),
    check("credit_payments_settlement_asset_check", sql`${t.settlement_asset} in ('chr','usdc','usdt')`),
    check(
      "credit_payments_status_check",
      sql`${t.status} in ('created','pending','confirmed','overpaid','underpaid','expired','canceled')`,
    ),
  ],
);

// Webhook de-duplication: the id is Chromia Pay's event id, so a redelivery
// collides on the primary key instead of being processed twice.
export const cpay_events = pgTable("cpay_events", {
  id: text().primaryKey().notNull(),
  type: text(),
  cpay_payment_id: text(),
  received_at: timestamp({ withTimezone: true, mode: "string" }).defaultNow().notNull(),
});

export const erc8004_attestations = pgTable(
  "erc8004_attestations",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    deployment_id: uuid()
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    agent_id: bigint({ mode: "number" }).notNull(),
    chain_id: integer().notNull(),
    // The EXACT bytes served at /api/agents/attestation/<id>. keccak256 of this
    // string is what went on-chain, so rewriting it invalidates the attestation.
    summary: text().notNull(),
    request_hash: text().notNull(),
    request_tx: text(),
    response_tx: text(),
    response_value: integer(),
    created_at: timestamp({ withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (t) => [index("erc8004_attestations_deployment_idx").on(t.deployment_id, t.created_at.desc())],
);
