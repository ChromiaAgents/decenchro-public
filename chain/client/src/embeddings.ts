import { OPENROUTER_API_KEY, EMBEDDING_MODEL, requireEnv } from "./config.js";

// OpenRouter exposes an OpenAI-compatible embeddings endpoint, so the agent's
// existing OPENROUTER_API_KEY also covers semantic memory — no second key.
const EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";

// Embed text into a vector. The chosen model must produce vectors matching the
// dimensions declared for the agent_memory collection in chromia.yml.
export async function embed(text: string): Promise<number[]> {
  const key = requireEnv("OPENROUTER_API_KEY", OPENROUTER_API_KEY);
  const res = await fetch(EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });
  if (!res.ok) {
    throw new Error(`Embedding request failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { data?: { embedding: number[] }[] };
  const vector = json.data?.[0]?.embedding;
  if (!vector) throw new Error("Embedding response missing data");
  return vector;
}

// Format a vector as the text form stored on-chain: "[0.1,0.2,...]".
export function formatVector(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

// Parse the on-chain text form back into numbers.
export function parseVector(text: string): number[] {
  return JSON.parse(text) as number[];
}

// Cosine similarity of two equal-length vectors, in [-1, 1]. Used to rank
// stored embeddings against a query embedding entirely client-side.
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
