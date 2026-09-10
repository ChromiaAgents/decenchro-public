#!/usr/bin/env tsx
/**
 * End-to-end test: exercises the full memory lifecycle against a running Chromia node.
 */

import {
  createNamespace,
  getNamespace,
  storeMemory,
  recallMemory,
  recallSemantic,
  listMemories,
  searchByTag,
  countMemories,
  updateMemory,
  deleteMemory,
  getAuditLog,
} from "./memory.js";
import { OPENROUTER_API_KEY } from "./config.js";

const NS = "e2e-test-" + Date.now();

async function run() {
  console.log("=== E2E Test: Decenchro On-chain Memory ===\n");

  // 1. Create namespace
  console.log("1. Creating namespace:", NS);
  await createNamespace(NS, "private");
  const ns = await getNamespace(NS);
  console.log("   ✓ Namespace created:", ns.name, "policy:", ns.read_policy);

  // 2. Store memory
  console.log("\n2. Storing memory...");
  const { entryId, txRid } = await storeMemory(
    "User prefers TypeScript over JavaScript",
    "correction",
    "preference,language",
    90,
    NS
  );
  console.log("   ✓ Stored entry:", entryId, "tx:", txRid.slice(0, 16) + "...");

  // 3. Recall memory
  console.log("\n3. Recalling memory...");
  const mem = await recallMemory(entryId, NS);
  console.log("   ✓ Content:", mem.content);
  console.log("   ✓ Source:", mem.source, "Confidence:", mem.confidence);

  // 4. Count
  console.log("\n4. Counting memories...");
  const count = await countMemories(NS);
  console.log("   ✓ Count:", count);

  // 5. Store another and search by tag
  console.log("\n5. Storing second memory and searching by tag...");
  const { entryId: entryId2 } = await storeMemory(
    "Works at a blockchain company",
    "conversation",
    "work,company",
    80,
    NS
  );
  const prefs = await searchByTag("preference", NS);
  console.log("   ✓ 'preference' tag matches:", prefs.length);
  const work = await searchByTag("work", NS);
  console.log("   ✓ 'work' tag matches:", work.length);

  // 6. List memories
  console.log("\n6. Listing all memories...");
  const all = await listMemories(50, 0, NS);
  console.log("   ✓ Total listed:", all.length);

  // 7. Update memory
  console.log("\n7. Updating memory...");
  await updateMemory(entryId, "User strongly prefers TypeScript", "preference,language,strong", 95, NS);
  const updated = await recallMemory(entryId, NS);
  console.log("   ✓ Updated content:", updated.content);
  console.log("   ✓ Updated confidence:", updated.confidence);

  // 8. Delete memory
  console.log("\n8. Deleting second memory...");
  await deleteMemory(entryId2, NS);
  const countAfter = await countMemories(NS);
  console.log("   ✓ Count after delete:", countAfter);

  // 9. Audit log
  console.log("\n9. Checking audit log...");
  const log = await getAuditLog(20, NS);
  console.log("   ✓ Audit entries:", log.length);
  for (const entry of log) {
    console.log("     -", entry.action, entry.entry_id || "(namespace)");
  }

  // 10. Semantic recall — runs on any node when an OpenRouter key is set
  // (embeddings are stored on-chain; ranking is client-side).
  if (OPENROUTER_API_KEY) {
    console.log("\n10. Semantic recall...");
    await storeMemory(
      "The user's favorite programming language is Rust",
      "observation",
      "preference,language",
      85,
      NS
    );
    await storeMemory("The user lives in Berlin and works remotely", "conversation", "personal", 80, NS);
    await storeMemory("The deployment pipeline runs on GitHub Actions", "decision", "infra", 75, NS);

    const hits = await recallSemantic("which programming language does the user prefer?", 3, NS);
    console.log("   ✓ Semantic hits:", hits.length);
    for (const h of hits) console.log("     -", h.content);
    if (hits.length === 0) throw new Error("semantic recall returned no results");
    if (!hits[0].content.includes("Rust")) {
      throw new Error(`expected the language memory ranked first, got: "${hits[0].content}"`);
    }
    console.log("   ✓ Top hit is the language memory, ranked correctly");
  } else {
    console.log("\n10. Semantic recall — SKIPPED (no OPENROUTER_API_KEY set)");
  }

  console.log("\n=== All E2E tests passed! ===");
}

run().catch((err) => {
  console.error("E2E FAILED:", err.message);
  process.exit(1);
});
