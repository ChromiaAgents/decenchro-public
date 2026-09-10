---
name: decenchro-memory
description: >
  On-chain memory for Decenchro agent. Store, recall, search, update, and delete
  memories on the Chromia blockchain. Use this skill whenever you need to persist
  or retrieve information across conversations.
version: 1.0.0
author: Decenchro
license: MIT
metadata:
  hermes:
    tags: [memory, blockchain, chromia, persistence, on-chain]
    related_skills: [chromia-skill]
---

# Decenchro On-chain Memory

## Overview

You have persistent memory stored on the Chromia blockchain. Every important fact, preference, correction, and decision can be stored on-chain — tamper-proof and verifiable.

**Your memory CLI:** `decenchro-mem`

All commands: `decenchro-mem <command> [args]`

All output is JSON.

## When to Store Memories

Store a memory when you learn something worth remembering across conversations:

- User corrections ("don't do X", "I prefer Y")
- User facts (name, role, preferences, tech stack)
- Decisions made ("we chose Postgres over Mongo because...")
- Important context ("the API key rotates monthly")
- Learned patterns ("this codebase uses snake_case")

**Do NOT store:**
- Ephemeral chat (greetings, small talk)
- Information already on-chain
- Sensitive secrets (API keys, passwords, tokens)

## When to Recall Memories

Query your on-chain memory **before** answering when:

- User asks "do you remember..." or "what did we decide about..."
- Starting a new conversation (list recent memories for context)
- User references past work or decisions
- You need context about user preferences

Prefer `search --query` (semantic) for recall — it finds relevant memories
even when the wording differs. It works on any node; it just needs an
`OPENROUTER_API_KEY` for embeddings. Without a key, fall back to `search
--tag` and `list`.

## Commands

### Store a memory

```bash
decenchro-mem store "<content>" --source <source> --tags "<comma-separated>" --confidence <0-100>
```

**Sources:** `correction`, `conversation`, `observation`, `decision`

**Confidence:** 0-100. Use 90+ for direct user statements, 70-80 for inferences, 50-60 for guesses.

Example:
```bash
decenchro-mem store "User prefers TypeScript over JavaScript" --source correction --tags "preference,language" --confidence 95
```

Returns: `{"entryId":"<uuid>","txRid":"<hex>"}`

### Recall a specific memory

```bash
decenchro-mem recall <entry-id>
```

### List all memories

```bash
decenchro-mem list --limit 20 --offset 0
```

### Semantic search

```bash
decenchro-mem search --query "<natural language question>" --limit 5
```

Embeds the query and returns the closest memories by meaning, ranked — finds
relevant memories even when the wording differs from how they were stored.
Embeddings are stored on-chain and ranked client-side, so this works on any
node. It needs an `OPENROUTER_API_KEY` (for embeddings); without one it returns
a clear error — fall back to `search --tag`.

### Search by tag

```bash
decenchro-mem search --tag "<tag>"
```

Exact tag match. Use when you know the precise tag. Common tags:
`preference`, `decision`, `fact`, `correction`, `context`, `language`, `work`, `project`

### Count memories

```bash
decenchro-mem count
```

### Update a memory

```bash
decenchro-mem update <entry-id> "<new-content>" --tags "<tags>" --confidence <0-100>
```

### Delete a memory

```bash
decenchro-mem delete <entry-id>
```

### Audit log

```bash
decenchro-mem audit --limit 20
```

### Namespace management

```bash
decenchro-mem namespace info decenchro-agent
```

## Behavior Rules

1. **Store immediately** — don't batch or defer. When you learn something, store it now.
2. **Check before answering** — if the user asks about past context, search your memory first.
3. **Be transparent** — tell the user when you store or recall a memory. Example: "I've stored that preference on-chain." or "Checking my on-chain memory..."
4. **Tag consistently** — use lowercase, descriptive tags. Multiple tags per memory.
5. **Update, don't duplicate** — if you have an existing memory on the same topic, update it instead of creating a new one. (Storing identical content is also deduped on-chain — it refreshes the existing entry — but updating deliberately keeps confidence and tags accurate.)
6. **Consolidate periodically** — when several memories circle the same topic, merge them into one clear memory and delete the fragments. A small set of sharp memories beats a long noisy list.
7. **Cite the chain** — when recalling, you can mention the entry ID or tx hash for verifiability.
8. **Confidence matters** — lower confidence for inferences, higher for direct statements.

## Error Handling

If a CLI command fails, check:
- Is the Chromia node running? (`curl http://localhost:7740/brid/iid_0`)
- Is the `.env` configured? (needs `CHROMIA_BRID`, `ADMIN_PRIVKEY`, `AGENT_NAMESPACE`;
  plus `OPENROUTER_API_KEY` for semantic search)
- Tell the user if memory is unavailable — don't silently skip.

**Without an `OPENROUTER_API_KEY`, store/recall/tag-search still work** — only
semantic `search --query` is unavailable (it returns a clear error). With a key,
`store` and `update` embed the content via OpenRouter before writing on-chain;
if the endpoint is unreachable or rate-limited, the command fails and **nothing
is stored** — tell the user the memory was not stored, don't pretend it
succeeded, don't retry blindly.
