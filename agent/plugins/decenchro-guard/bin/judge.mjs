#!/usr/bin/env node
// Single-shot Atbash judge shim.
//
// Input  (stdin, JSON):  { "toolName": "...", "args": <any>, "context": "..." }
// Output (stdout, JSON): { "allow": bool, "verdict": "...", "reason": "...", "toolCallId": "..." }
//
// Exit code is always 0 on a parsed verdict (including BLOCK/HOLD/ERROR) so the
// Python caller can read the JSON. Non-zero only on shim-level failures
// (bad input, SDK init crash) — those are treated by the caller as fail-closed.

import { createAtbashClient } from "@atbash/sdk";

function readStdin() {
  return new Promise((resolve, reject) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { buf += chunk; });
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", reject);
  });
}

function envOrDefault(name, fallback) {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

async function main() {
  const raw = await readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`decenchro-guard: bad input JSON: ${err.message}\n`);
    process.exit(2);
  }

  const privkey = process.env.ATBASH_AGENT_KEY;
  if (!privkey) {
    process.stderr.write("decenchro-guard: ATBASH_AGENT_KEY not set\n");
    process.exit(3);
  }

  // Derive pubkey from privkey via SDK helper (loadAgent inside createAtbashClient
  // handles validation). Pass keyPair inline so we never touch ~/.atbashrc.
  let pubkey;
  try {
    const { derivePublicKey } = await import("@atbash/sdk");
    pubkey = derivePublicKey(privkey);
  } catch (err) {
    process.stderr.write(`decenchro-guard: key derive failed: ${err.message}\n`);
    process.exit(4);
  }

  const endpoint = envOrDefault("ATBASH_ENDPOINT", undefined);
  const blockchainRid = envOrDefault("ATBASH_BLOCKCHAIN_RID", undefined);

  const client = createAtbashClient({
    keyPair: { privKey: privkey, pubKey: pubkey },
    judge: endpoint ? { policy: "default", endpoint } : undefined,
    blockchainRid,
    // Fail closed by default — if the judge can't reach a verdict, block.
    failClosed: envOrDefault("ATBASH_FAIL_OPEN", "0") !== "1",
    logger: {
      info: (..._a) => {},
      warn: (...a) => process.stderr.write(`[atbash] ${a.map(String).join(" ")}\n`),
    },
  });

  try {
    const decision = await client.auditToolCall({
      toolName: input.toolName ?? "unknown",
      args: input.args,
      context: input.context,
    });
    process.stdout.write(JSON.stringify(decision) + "\n");
  } catch (err) {
    // Bubble as a verdict-shaped error so Python doesn't need a separate path.
    process.stdout.write(JSON.stringify({
      allow: false,
      verdict: "ERROR",
      reason: `shim exception: ${err?.message ?? String(err)}`,
    }) + "\n");
  }
}

main();
