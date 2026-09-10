import { ensureAccount, getConnection, getPubKey } from "./client.js";
import { AGENT_NAMESPACE, OPENROUTER_API_KEY } from "./config.js";
import { embed, formatVector, parseVector, cosineSimilarity } from "./embeddings.js";
import { randomUUID } from "crypto";

// ── Types ─────────────────────────────────────────────────────────────

export interface MemoryEntry {
  entry_id: string;
  namespace_name: string;
  content: string;
  source: string;
  tags: string;
  confidence: number;
  created_at: number;
  updated_at: number;
}

export interface NamespaceInfo {
  name: string;
  owner: Buffer;
  read_policy: string;
  memory_count: number;
  created_at: number;
}

export interface AuditEntry {
  actor: Buffer;
  action: string;
  entry_id: string;
  detail: string;
  created_at: number;
}

// ── Namespace ─────────────────────────────────────────────────────────

export async function createNamespace(name: string, readPolicy: string = "private") {
  const session = await ensureAccount();
  return session.call({
    name: "memory.create_namespace",
    args: [name, readPolicy],
  });
}

export async function getNamespace(name: string): Promise<NamespaceInfo> {
  const connection = await getConnection();
  return connection.query("memory.get_namespace", { name });
}

// Namespaces owned by a given key. Used to map a fleet agent (identified by
// its pubkey) to the memory namespace(s) it owns.
export async function getNamespacesByOwner(
  ownerHex: string
): Promise<NamespaceInfo[]> {
  const connection = await getConnection();
  const owner = Buffer.from(ownerHex.replace(/^0x/, ""), "hex");
  return connection.query("memory.get_namespaces_by_owner", { owner });
}

// ── Store ─────────────────────────────────────────────────────────────

export async function storeMemory(
  content: string,
  source: string = "conversation",
  tags: string = "",
  confidence: number = 70,
  namespace?: string
): Promise<{ entryId: string; txRid: string }> {
  const session = await ensureAccount();
  const ns = namespace || AGENT_NAMESPACE;
  const entryId = randomUUID();
  // Embed only when a key is configured. Without one the memory is still
  // stored and fully usable — just not reachable by semantic search.
  const vector = OPENROUTER_API_KEY ? formatVector(await embed(content)) : "";

  const result = await session.call({
    name: "memory.store_memory",
    args: [ns, entryId, content, source, tags, confidence, vector],
  });

  return {
    entryId,
    txRid: Buffer.from(result.receipt.transactionRid).toString("hex"),
  };
}

// ── Update ────────────────────────────────────────────────────────────

export async function updateMemory(
  entryId: string,
  content: string,
  tags: string = "",
  confidence: number = 70,
  namespace?: string
) {
  const session = await ensureAccount();
  const ns = namespace || AGENT_NAMESPACE;
  // Re-embed the new content when a key is configured; otherwise pass "" so the
  // chain drops the now-stale embedding rather than keep one for old content.
  const vector = OPENROUTER_API_KEY ? formatVector(await embed(content)) : "";

  return session.call({
    name: "memory.update_memory",
    args: [ns, entryId, content, tags, confidence, vector],
  });
}

// ── Delete ────────────────────────────────────────────────────────────

export async function deleteMemory(entryId: string, namespace?: string) {
  const session = await ensureAccount();
  const ns = namespace || AGENT_NAMESPACE;

  return session.call({
    name: "memory.delete_memory",
    args: [ns, entryId],
  });
}

// ── Recall / Query ────────────────────────────────────────────────────

export async function recallMemory(entryId: string, namespace?: string): Promise<MemoryEntry> {
  const connection = await getConnection();
  const ns = namespace || AGENT_NAMESPACE;

  return connection.query("memory.get_memory", {
    namespace_name: ns,
    entry_id: entryId,
    reader: getPubKey(),
  });
}

export async function listMemories(
  limit: number = 50,
  offset: number = 0,
  namespace?: string
): Promise<MemoryEntry[]> {
  const connection = await getConnection();
  const ns = namespace || AGENT_NAMESPACE;

  return connection.query("memory.list_memories", {
    namespace_name: ns,
    reader: getPubKey(),
    max_count: limit,
    skip_count: offset,
  });
}

export async function searchByTag(tag: string, namespace?: string): Promise<MemoryEntry[]> {
  const connection = await getConnection();
  const ns = namespace || AGENT_NAMESPACE;

  return connection.query("memory.search_memories_by_tag", {
    namespace_name: ns,
    tag,
    reader: getPubKey(),
  });
}

// Semantic recall — entirely client-side, works on any plain node:
//   1. fetch every embedding in the namespace (get_namespace_embeddings)
//   2. embed the query, cosine-rank locally, take the top k
//   3. fetch full content for just those k (get_memories_by_ids)
// O(n) over namespace size — fine into the low thousands of memories.
export async function recallSemantic(
  query: string,
  k: number = 5,
  namespace?: string
): Promise<MemoryEntry[]> {
  if (!OPENROUTER_API_KEY) {
    throw new Error(
      "Semantic search needs OPENROUTER_API_KEY (for embeddings). " +
        "Use search by tag instead, or set the key."
    );
  }
  const connection = await getConnection();
  const ns = namespace || AGENT_NAMESPACE;
  const reader = getPubKey();

  const embeddings: { entry_id: string; vector: string }[] = await connection.query(
    "memory.get_namespace_embeddings",
    { namespace_name: ns, reader }
  );
  if (embeddings.length === 0) return [];

  const qVector = await embed(query);
  const topIds = embeddings
    .map((e) => ({ entry_id: e.entry_id, score: cosineSimilarity(qVector, parseVector(e.vector)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((r) => r.entry_id);

  const memories: MemoryEntry[] = await connection.query("memory.get_memories_by_ids", {
    namespace_name: ns,
    entry_ids: topIds,
    reader,
  });

  // get_memories_by_ids returns unordered — restore the ranked order.
  const byId = new Map(memories.map((m) => [m.entry_id, m]));
  return topIds.map((id) => byId.get(id)).filter((m): m is MemoryEntry => m !== undefined);
}

export async function countMemories(namespace?: string): Promise<number> {
  const connection = await getConnection();
  const ns = namespace || AGENT_NAMESPACE;

  return connection.query("memory.count_memories", {
    namespace_name: ns,
    reader: getPubKey(),
  });
}

// ── Audit ─────────────────────────────────────────────────────────────

export async function getAuditLog(limit: number = 20, namespace?: string): Promise<AuditEntry[]> {
  const connection = await getConnection();
  const ns = namespace || AGENT_NAMESPACE;

  return connection.query("memory.get_audit_log", {
    namespace_name: ns,
    reader: getPubKey(),
    max_count: limit,
  });
}

// ── Access Control ────────────────────────────────────────────────────

export async function grantAccess(granteePubkey: Buffer, namespace?: string) {
  const session = await ensureAccount();
  const ns = namespace || AGENT_NAMESPACE;

  return session.call({
    name: "memory.grant_access",
    args: [ns, granteePubkey],
  });
}

export async function revokeAccess(granteePubkey: Buffer, namespace?: string) {
  const session = await ensureAccount();
  const ns = namespace || AGENT_NAMESPACE;

  return session.call({
    name: "memory.revoke_access",
    args: [ns, granteePubkey],
  });
}
