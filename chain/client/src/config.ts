import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(import.meta.dirname, "../.env") });

export const CHROMIA_NODE_URL = process.env.CHROMIA_NODE_URL || "http://localhost:7740";
export const CHROMIA_BRID = process.env.CHROMIA_BRID || "";
export const ADMIN_PRIVKEY = process.env.ADMIN_PRIVKEY || "";
export const AGENT_NAMESPACE = process.env.AGENT_NAMESPACE || "default";

// Embeddings — routed through OpenRouter (OpenAI-compatible endpoint).
// Optional: with a key, memories are embedded on store and semantic recall
// works on any node. Without one, store/recall still work — only `search
// --query` (semantic) is unavailable.
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "openai/text-embedding-3-small";

export function requireEnv(name: string, value: string): string {
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}
