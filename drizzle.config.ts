import { defineConfig } from "drizzle-kit";

// Schema and migrations both live under db/. `drizzle-kit generate` writes new
// migrations here; scripts/migrate.mjs applies them, keyed on filename rather
// than on drizzle's journal (the first three files were hand-written).
export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "",
  },
});
