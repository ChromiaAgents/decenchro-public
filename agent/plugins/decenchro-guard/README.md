# decenchro-guard

A Hermes plugin that routes Decenchro's tool calls through the
[Atbash](https://atbash.ai) judge before they execute. Maps Atbash verdicts to
Hermes `pre_tool_call` actions:

| Verdict  | Action                                              |
|----------|-----------------------------------------------------|
| `ALLOW`  | proceed                                              |
| `BLOCK`  | abort tool call with the judge's reason             |
| `HOLD`   | abort, surface the `tool_call_id` for operator review |
| `ERROR`  | fail-closed (block) by default; `ATBASH_FAIL_OPEN=1` to fail-open |

Only tools in `ATBASH_GUARDED_TOOLS` (default
`terminal,read_file,write_file,patch,search_files,web_search,web_extract,decenchro-mem`)
are gated. Trim via env var if you want lighter coverage.

## Architecture

```
Hermes (Python)
  └─ pre_tool_call hook
       └─ subprocess → bin/judge.mjs (Node)
              └─ @atbash/sdk · createAtbashClient.auditToolCall
                     └─ Atbash judge API → Chromia
```

The Hermes plugin system is Python; the Atbash SDK is TypeScript/Node. The
shim is the bridge — one Node call per gated tool invocation, stdin/stdout
JSON.

## Setup

1. **Onboard the agent at the dashboard.**
   Create the agent at <https://atbash.ai/risk-engine/agents>, attach a policy
   pack, and copy the private key. The agent must be assigned to an org on the
   Audit+ or Enforcement tier for verdicts to be returned (Audit tier
   short-circuits to `ALLOW` with a "no verdict" reason — still useful for
   the on-chain audit trail).

2. **Install the Node dependency.**
   ```bash
   cd agent/plugins/decenchro-guard
   npm install
   ```

3. **Export the key.**
   ```bash
   export ATBASH_AGENT_KEY=<64-char-hex-privkey>
   ```
   See `agent/.env.example` for the full set of env vars.

4. **Enable the plugin in Hermes.**
   ```bash
   hermes plugins enable decenchro-guard
   ```
   (Or symlink/copy this directory into `~/.hermes/plugins/` if running from
   a local checkout.)

## First deploy: audit-only mode

Set `ATBASH_AUDIT_ONLY=1` for the first day or so. The plugin will log every
verdict but never block — this surfaces false positives in the policy without
breaking the agent. Flip it off once the policy is tuned.

## Tuning the allowlist

`ATBASH_GUARDED_TOOLS` is a comma-separated list of Hermes tool names. Keep it
small: every gated call is one round-trip to the judge (~hundreds of ms). Good
candidates are tools that produce side effects you care about — shell
execution, filesystem writes, on-chain memory writes, network requests with
auth. Read-only tools (file reads, search) don't need to be gated.

## Failure modes

- **Shim missing / `node` not on PATH** — the plugin no-ops (logs a warning).
  Won't gate, won't block.
- **`ATBASH_AGENT_KEY` unset** — the plugin no-ops. Treat as "not configured."
- **Judge unreachable** — fail-closed by default (block). Set
  `ATBASH_FAIL_OPEN=1` to invert during development.
- **Agent jailed (Enforcement tier, after a BLOCK)** — every subsequent call
  returns BLOCK until you unjail at the dashboard.
