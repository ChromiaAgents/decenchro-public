# Decenchro

An AI agent that keeps a tamper-proof record of what it does.

Decenchro runs an open-source agent ([Hermes](https://hermes-agent.nousresearch.com/)
by NousResearch) and writes its memory to the [Chromia](https://chromia.com/)
blockchain. You can read that record later. Nobody can change it after the fact.

## What you get

- **An agent you talk to on Telegram.** It remembers your past conversations.
- **A record you can check.** Every memory and every tool call goes on-chain.
- **A guard.** Risky actions are checked before the agent runs them.

## Two ways to use it

**1. Hosted (easiest).** Go to [decenchro.com](https://decenchro.com), sign up,
and deploy an agent from the console. It takes about two minutes. The console
also shows you the agent status, its memory, the audit trail and the cost.

**2. Local.** Run the agent on your own machine with the steps below.

## Run it locally

```bash
git clone https://github.com/ChromiaAgents/decenchro-public.git
cd decenchro-public
./setup-local.sh
```

The script installs the Hermes agent, the Chromia skill and the guard plugin.

### Add your keys

Open `~/.hermes/.env` and put your keys in it:

```bash
OPENROUTER_API_KEY=sk-or-xxxxxxxxxxxxxxxxxxxx
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
TELEGRAM_ALLOWED_USERS=123456789
```

Where to get them:

| Key | Where |
| --- | --- |
| `OPENROUTER_API_KEY` | [openrouter.ai/keys](https://openrouter.ai/keys) |
| `TELEGRAM_BOT_TOKEN` | Send a message to [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_ALLOWED_USERS` | Send a message to [@userinfobot](https://t.me/userinfobot) |

### Start the agent

```bash
hermes chat -q "What can you help me build?"   # try it in the terminal
hermes gateway                                 # start the Telegram bot
hermes doctor                                  # check the setup
```

## How a hosted deploy works

The console starts a [Render](https://render.com) service that runs a prebuilt
agent image. The image already holds the agent, the Chromia skill and the guard,
so there is nothing to install and nothing to configure on a server. Each agent
gets its own settings and its own disk for memory. You do not manage a server.

Every agent runs the same language model through OpenRouter, so the cost per
hour is predictable and shown in the console.

## Agents on BNB Smart Chain (ERC-8004)

Every deployed agent gets an [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)
identity on BNB Smart Chain, and its audit trail is anchored there once a day.
[decenchro.com/agents](https://decenchro.com/agents) is a public marketplace
over that registry.

| Piece | Where |
| --- | --- |
| Registration and attestation | `lib/dashboard/bsc.ts`, `lib/dashboard/erc8004-abi.ts` |
| Daily attest cron | `app/api/agents/attest/route.ts` |
| Agent card and attestation JSON | `app/api/agents/card/`, `app/api/agents/attestation/` |
| Marketplace | `app/agents/`, `lib/marketplace/` |
| DeFi CLI the agent drives (PancakeSwap v2/v3, Venus) | `agent/bsc-defi/` |
| DeFi skills (health, rebalance, grid, yield) | `agent/skills/bsc-*/` |
| Agent Advantage Report (TermiX track) | `docs/agent-advantage-report.md` |

```bash
node scripts/check-erc8004.mjs              # registries reachable, register() simulates
cd agent/bsc-defi && npm ci && npm test     # CLI unit tests
node agent/bsc-defi/bin/bsc-defi.mjs doctor # verify pinned protocol addresses live
```

The chain is picked by `BSC_CHAIN_ID` (97 testnet, 56 mainnet). Registration is
best-effort: without `PLATFORM_BSC_PRIVKEY` a deploy works exactly as before.

## What is in this repo

```
decenchro/
├── app/            The website and the operator console (Next.js)
├── components/     The interface parts of the site and console
├── lib/            Deploys, billing, BSC identity, marketplace data
├── agent/          The agent identity, config and skills
├── chain/          The on-chain memory module (Rell) and its client
├── docker/agent/   The prebuilt agent image
├── docs/           The Agent Advantage Report
└── setup-local.sh  The local install script
```

## Built with

| Part | What we use |
| --- | --- |
| Agent | [Hermes Agent](https://hermes-agent.nousresearch.com/) by NousResearch |
| Language models | [OpenRouter](https://openrouter.ai) |
| Blockchain | [Chromia](https://chromia.com/) |
| Guard | [Atbash](https://atbash.ai) |
| Chat | Telegram |
| Website | Next.js, hosted on Vercel |

## Work on the website

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # production build and type check
```

## License

MIT, see [LICENSE](LICENSE).

## Source

The public repository, [ChromiaAgents/decenchro-public](https://github.com/ChromiaAgents/decenchro-public),
is a squashed mirror of the development repo, rebuilt by
`scripts/build-public-mirror.sh`, so its history is one commit per publish.
