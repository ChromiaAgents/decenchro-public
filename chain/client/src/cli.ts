#!/usr/bin/env tsx
/**
 * CLI interface for Hermes Agent to interact with Chromia on-chain memory.
 *
 * Usage (called by Hermes agent via shell):
 *   tsx cli.ts store "User prefers TypeScript" --source correction --tags "preference,language" --confidence 90
 *   tsx cli.ts recall <entry-id>
 *   tsx cli.ts list [--limit 50] [--offset 0]
 *   tsx cli.ts search --query "what does the user prefer?" [--limit 5]
 *   tsx cli.ts search --tag "preference"
 *   tsx cli.ts namespace create <name> [--policy private|shared|public]
 *   tsx cli.ts namespace info <name>
 *   tsx cli.ts audit [--limit 20]
 *   tsx cli.ts count
 *   tsx cli.ts delete <entry-id>
 *
 * All output is JSON for easy parsing by the agent.
 */

import {
  storeMemory,
  recallMemory,
  recallSemantic,
  listMemories,
  searchByTag,
  countMemories,
  deleteMemory,
  updateMemory,
  getAuditLog,
  createNamespace,
  getNamespace,
  getNamespacesByOwner,
} from "./memory.js";

const args = process.argv.slice(2);
const command = args[0];

function getFlag(flag: string, defaultValue: string = ""): string {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return defaultValue;
  return args[idx + 1];
}

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

async function main() {
  try {
    switch (command) {
      case "store": {
        const content = args[1];
        if (!content) {
          console.error(JSON.stringify({ error: "Content required: tsx cli.ts store <content>" }));
          process.exit(1);
        }
        const result = await storeMemory(
          content,
          getFlag("--source", "conversation"),
          getFlag("--tags", ""),
          parseInt(getFlag("--confidence", "70")),
          getFlag("--namespace") || undefined
        );
        console.log(JSON.stringify(result));
        break;
      }

      case "recall": {
        const entryId = args[1];
        if (!entryId) {
          console.error(JSON.stringify({ error: "Entry ID required: tsx cli.ts recall <entry-id>" }));
          process.exit(1);
        }
        const memory = await recallMemory(entryId, getFlag("--namespace") || undefined);
        console.log(JSON.stringify(memory));
        break;
      }

      case "list": {
        const memories = await listMemories(
          parseInt(getFlag("--limit", "50")),
          parseInt(getFlag("--offset", "0")),
          getFlag("--namespace") || undefined
        );
        console.log(JSON.stringify(memories));
        break;
      }

      case "search": {
        const query = getFlag("--query");
        const tag = getFlag("--tag");
        if (query) {
          const results = await recallSemantic(
            query,
            parseInt(getFlag("--limit", "5")),
            getFlag("--namespace") || undefined
          );
          console.log(JSON.stringify(results));
        } else if (tag) {
          const results = await searchByTag(tag, getFlag("--namespace") || undefined);
          console.log(JSON.stringify(results));
        } else {
          console.error(JSON.stringify({
            error: "Provide --query <text> for semantic search, or --tag <tag> for tag search",
          }));
          process.exit(1);
        }
        break;
      }

      case "count": {
        const count = await countMemories(getFlag("--namespace") || undefined);
        console.log(JSON.stringify({ count }));
        break;
      }

      case "delete": {
        const entryId = args[1];
        if (!entryId) {
          console.error(JSON.stringify({ error: "Entry ID required: tsx cli.ts delete <entry-id>" }));
          process.exit(1);
        }
        await deleteMemory(entryId, getFlag("--namespace") || undefined);
        console.log(JSON.stringify({ deleted: entryId }));
        break;
      }

      case "update": {
        const entryId = args[1];
        const content = args[2];
        if (!entryId || !content) {
          console.error(JSON.stringify({ error: "Usage: tsx cli.ts update <entry-id> <content>" }));
          process.exit(1);
        }
        await updateMemory(
          entryId,
          content,
          getFlag("--tags", ""),
          parseInt(getFlag("--confidence", "70")),
          getFlag("--namespace") || undefined
        );
        console.log(JSON.stringify({ updated: entryId }));
        break;
      }

      case "namespace": {
        const subCmd = args[1];
        if (subCmd === "create") {
          const name = args[2];
          if (!name) {
            console.error(JSON.stringify({ error: "Name required: tsx cli.ts namespace create <name>" }));
            process.exit(1);
          }
          await createNamespace(name, getFlag("--policy", "private"));
          console.log(JSON.stringify({ created: name }));
        } else if (subCmd === "info") {
          const name = args[2];
          if (!name) {
            console.error(JSON.stringify({ error: "Name required: tsx cli.ts namespace info <name>" }));
            process.exit(1);
          }
          const info = await getNamespace(name);
          console.log(JSON.stringify(info));
        } else if (subCmd === "by-owner") {
          const owner = args[2] || getFlag("--owner");
          if (!owner) {
            console.error(JSON.stringify({ error: "Owner pubkey required: tsx cli.ts namespace by-owner <hex>" }));
            process.exit(1);
          }
          const list = await getNamespacesByOwner(owner);
          console.log(JSON.stringify(list));
        } else {
          console.error(JSON.stringify({ error: "Unknown subcommand. Use: namespace create|info|by-owner" }));
          process.exit(1);
        }
        break;
      }

      case "audit": {
        const log = await getAuditLog(
          parseInt(getFlag("--limit", "20")),
          getFlag("--namespace") || undefined
        );
        console.log(JSON.stringify(log));
        break;
      }

      default:
        console.error(JSON.stringify({
          error: "Unknown command",
          usage: {
            store: "tsx cli.ts store <content> [--source x] [--tags x] [--confidence n]",
            recall: "tsx cli.ts recall <entry-id>",
            list: "tsx cli.ts list [--limit n] [--offset n]",
            search: "tsx cli.ts search --query <text> [--limit n] | search --tag <tag>",
            count: "tsx cli.ts count",
            delete: "tsx cli.ts delete <entry-id>",
            update: "tsx cli.ts update <entry-id> <content> [--tags x] [--confidence n]",
            namespace: "tsx cli.ts namespace create|info <name>",
            audit: "tsx cli.ts audit [--limit n]",
          },
        }));
        process.exit(1);
    }
  } catch (err: any) {
    console.error(JSON.stringify({ error: err.message || String(err) }));
    process.exit(1);
  }
}

main();
