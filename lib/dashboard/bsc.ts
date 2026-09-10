import "server-only";

import { createHmac } from "node:crypto";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  parseEther,
  parseEventLogs,
  toBytes,
  type Account,
  type Chain,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { appBaseUrl } from "./app-url";
import { encryptionConfigured } from "./crypto";
import {
  erc8004Registries,
  IDENTITY_REGISTRY_ABI,
  REPUTATION_REGISTRY_ABI,
  VALIDATION_REGISTRY_ABI,
} from "./erc8004-abi";

// ERC-8004 on BNB Smart Chain. Every deployed agent gets its own derived wallet
// (HMAC of the deployment id — same derived-never-stored pattern as
// metricsToken/dashboardPassword; the key is also injected into the agent's
// container as BSC_AGENT_KEY, which is safe for exactly the reason those are:
// it is scoped to the one deployment whose tenant already controls it). The
// agent wallet mints its identity NFT, then grants the platform wallet
// operator rights so recurring writes (attestations, URI refreshes) never need
// the per-agent wallet funded again.
//
// Everything here is best-effort by design: bscConfigured() gates every entry
// point, and callers must treat failures as "deferred", never as a deploy
// failure. Chain selection is env-only so the mainnet flip (97 → 56) is
// config, not code.

const FUND_THRESHOLD_WEI = parseEther("0.002");
const FUND_AMOUNT_WEI = parseEther("0.005");

export function bscChainId(): number {
  const raw = Number.parseInt(process.env.BSC_CHAIN_ID ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 97;
}

export function bscRpcUrl(): string {
  const explicit = (process.env.BSC_RPC_URL ?? "").trim();
  if (explicit) return explicit;
  return bscChainId() === 56
    ? "https://bsc-rpc.publicnode.com"
    : "https://bsc-testnet-rpc.publicnode.com";
}

export function bscConfigured(): boolean {
  return Boolean(platformPrivkey()) && encryptionConfigured();
}

function platformPrivkey(): `0x${string}` | null {
  const raw = (process.env.PLATFORM_BSC_PRIVKEY ?? "").trim();
  if (!raw) return null;
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  return /^[0-9a-fA-F]{64}$/.test(hex) ? (`0x${hex}` as `0x${string}`) : null;
}

/**
 * Per-deployment BSC private key: HMAC-SHA256(ENCRYPTION_KEY,
 * "decenchro-bsc:" + deploymentId). A SHA-256 digest is a valid secp256k1
 * scalar unless it falls outside [1, n-1] (~2^-128 chance); re-hash with a
 * counter until it does, so the function is total.
 */
export function bscAgentKey(deploymentId: string): `0x${string}` {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error("ENCRYPTION_KEY must be at least 32 characters");
  }
  for (let counter = 0; ; counter++) {
    const suffix = counter === 0 ? "" : `:${counter}`;
    const digest = createHmac("sha256", key)
      .update(`decenchro-bsc:${deploymentId}${suffix}`)
      .digest("hex");
    const candidate = `0x${digest}` as `0x${string}`;
    try {
      privateKeyToAccount(candidate);
      return candidate;
    } catch {
      // out-of-range scalar; derive again with the counter appended
    }
  }
}

export function agentAccount(deploymentId: string): Account {
  return privateKeyToAccount(bscAgentKey(deploymentId));
}

/** The agent's public BSC address — safe to store and display. */
export function derivedBscAddress(deploymentId: string): `0x${string}` {
  return agentAccount(deploymentId).address;
}

export function platformAccount(): Account {
  const pk = platformPrivkey();
  if (!pk) throw new Error("PLATFORM_BSC_PRIVKEY not configured");
  return privateKeyToAccount(pk);
}

// Built from env rather than viem/chains so 97/56 (or an override) work the
// same way without importing hardcoded chain objects.
function bscChain(): Chain {
  const id = bscChainId();
  return defineChain({
    id,
    name: id === 56 ? "BNB Smart Chain" : "BNB Smart Chain Testnet",
    nativeCurrency: { name: "BNB", symbol: id === 56 ? "BNB" : "tBNB", decimals: 18 },
    rpcUrls: { default: { http: [bscRpcUrl()] } },
  });
}

export function bscPublicClient(): PublicClient {
  return createPublicClient({ chain: bscChain(), transport: http(bscRpcUrl()) });
}

function bscWalletClient(account: Account) {
  return createWalletClient({
    account,
    chain: bscChain(),
    transport: http(bscRpcUrl()),
  });
}

// MegaFuel paymaster (opt-in): a sponsorship-fronting RPC that accepts
// zero-gas-price transactions for whitelisted targets — BNB Chain sponsors
// ERC-8004 registration on testnet through it. Set BSC_MEGAFUEL_RPC_URL
// (testnet: https://bsc-megafuel-testnet.nodereal.io) to send the agent
// wallet's registration txs gas-free; any sponsorship failure falls back to
// the funded path, so this can never break a deploy.
function megafuelRpcUrl(): string | null {
  const v = (process.env.BSC_MEGAFUEL_RPC_URL ?? "").trim();
  return v || null;
}

function sponsoredWalletClient(account: Account) {
  const url = megafuelRpcUrl();
  if (!url) return null;
  return createWalletClient({ account, chain: bscChain(), transport: http(url) });
}

/** Where this deployment's ERC-8004 registration file (agent card) is served. */
export function agentCardUrl(deploymentId: string): string {
  return `${appBaseUrl()}/api/agents/card/${deploymentId}`;
}

export type Erc8004Registration = {
  agentId: number;
  txHash: string;
  address: `0x${string}`;
  chainId: number;
};

/**
 * Mint this deployment's ERC-8004 identity: fund the derived wallet if it's
 * short on gas, register(agentCardUrl) from the agent wallet (the NFT mints to
 * msg.sender), then best-effort setApprovalForAll(platform) so later writes
 * come from the platform wallet. Each stage fails with a distinct message so
 * the deferred-registration audit log says which one broke.
 */
export async function registerAgentOnChain(
  deploymentId: string,
  opts: {
    /**
     * A register() hash from an earlier attempt that never had its receipt
     * read (the deploy path abandons the wait when it runs out of budget).
     * Adopted if it landed, so a retry recovers the existing identity instead
     * of minting a second one for the same agent.
     */
     pendingTx?: string | null;
    /**
     * Called with the register() hash the moment it is broadcast, BEFORE the
     * receipt wait. The deploy path persists it here so an abandoned wait
     * leaves a pointer to the mint rather than an orphan NFT.
     */
    onTxHash?: (hash: `0x${string}`) => Promise<void> | void;
  } = {},
): Promise<Erc8004Registration> {
  if (!bscConfigured()) throw new Error("bsc: PLATFORM_BSC_PRIVKEY not configured");
  const chainId = bscChainId();
  const registries = erc8004Registries(chainId);
  const publicClient = bscPublicClient();
  const agent = agentAccount(deploymentId);
  const platform = platformAccount();
  const sponsored = sponsoredWalletClient(agent);

  // One agent-wallet write, sponsored when MegaFuel is configured (gasPrice 0
  // through the paymaster RPC), funded otherwise. Sponsorship failures fall
  // back to the funded client within the same call.
  let funded = false;
  async function ensureFunded() {
    if (funded) return;
    const balance = await publicClient.getBalance({ address: agent.address });
    if (balance < FUND_THRESHOLD_WEI) {
      const fundTx = await bscWalletClient(platform).sendTransaction({
        to: agent.address,
        value: FUND_AMOUNT_WEI,
      });
      await publicClient.waitForTransactionReceipt({ hash: fundTx });
    }
    funded = true;
  }
  // The requests come straight out of simulateContract, so the call shape is
  // already validated; the casts below only bridge viem's transaction-type
  // discriminated union (a legacy gasPrice-0 write vs the simulate result's
  // eip1559 typing), not an unchecked call.
  type AgentCall = {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  };
  type WriteParams = Parameters<ReturnType<typeof bscWalletClient>["writeContract"]>[0];
  async function agentWrite(request: AgentCall): Promise<`0x${string}`> {
    const core = {
      address: request.address,
      abi: request.abi,
      functionName: request.functionName,
      args: request.args,
    };
    if (sponsored) {
      try {
        return await sponsored.writeContract({
          ...core,
          gasPrice: 0n,
          type: "legacy",
        } as unknown as WriteParams);
      } catch (err) {
        console.log(
          `[AUDIT] erc8004 megafuel sponsorship declined deployment=${deploymentId} reason=${
            err instanceof Error ? err.message : String(err)
          } — falling back to funded path`,
        );
      }
    }
    await ensureFunded();
    return bscWalletClient(agent).writeContract(core as unknown as WriteParams);
  }

  /** Pull the agentId out of a register() receipt, or throw saying why not. */
  async function adopt(hash: `0x${string}`): Promise<bigint> {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`tx ${hash} reverted`);
    const logs = parseEventLogs({
      abi: IDENTITY_REGISTRY_ABI,
      eventName: "Registered",
      logs: receipt.logs,
    });
    const id = logs[0]?.args.agentId;
    if (id == null) throw new Error(`tx ${hash}: no Registered event`);
    return id;
  }

  // A mint from a previous attempt whose receipt was never read. Adopting it is
  // one eth_getTransactionReceipt against re-minting and stranding an NFT that
  // this agent already owns.
  if (opts.pendingTx) {
    try {
      const adopted = await adopt(opts.pendingTx as `0x${string}`);
      return {
        agentId: Number(adopted),
        txHash: opts.pendingTx,
        address: agent.address,
        chainId,
      };
    } catch (err) {
      console.log(
        `[AUDIT] erc8004 pending tx not adoptable deployment=${deploymentId} tx=${
          opts.pendingTx
        } reason=${err instanceof Error ? err.message : String(err)} — registering fresh`,
      );
    }
  }

  // Register. Simulate first so a bad ABI/registry reverts before gas.
  let txHash: `0x${string}`;
  let agentId: bigint | null = null;
  try {
    const { request } = await publicClient.simulateContract({
      account: agent,
      address: registries.identity,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: "register",
      args: [agentCardUrl(deploymentId)],
    });
    txHash = await agentWrite(request);
    // Persisted before the receipt wait on purpose: the wait is what gets
    // abandoned when the caller's time budget expires, and without this the
    // mint that follows is unreachable — a paid-for NFT nobody knows about.
    await opts.onTxHash?.(txHash);
    agentId = await adopt(txHash);
  } catch (err) {
    throw new Error(`bsc register: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Operator grant. Best-effort — a failure here only means future
  // attestations fall back to the funded agent wallet.
  try {
    const { request } = await publicClient.simulateContract({
      account: agent,
      address: registries.identity,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: "setApprovalForAll",
      args: [platform.address, true],
    });
    const approveTx = await agentWrite(request);
    // Broadcast, not awaited. The receipt adds a whole block time to the
    // critical path for a grant that only affects LATER attestation writes, and
    // the attest cron re-grants if it turns out not to have landed. Waiting for
    // it is what pushed registration past the deploy route's time budget.
    console.log(
      `[AUDIT] erc8004 operator grant sent deployment=${deploymentId} tx=${approveTx}`,
    );
  } catch (err) {
    console.log(
      `[AUDIT] erc8004 operator grant failed deployment=${deploymentId} reason=${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  return {
    agentId: Number(agentId),
    txHash,
    address: agent.address,
    chainId,
  };
}

/**
 * Operator review of their own agent, signed by the platform wallet as the
 * feedback client (0-100, no decimals). tag1 is fixed so getSummary can filter
 * to operator reviews; tag2 carries the agent's category. No content URI — the
 * score is the payload, feedbackHash stays zero.
 */
export async function giveAgentFeedback(
  erc8004AgentId: number,
  value: number,
  categoryTag: string,
): Promise<{ txHash: string }> {
  if (!bscConfigured()) throw new Error("bsc: PLATFORM_BSC_PRIVKEY not configured");
  const registries = erc8004Registries(bscChainId());
  const publicClient = bscPublicClient();
  const platform = platformAccount();
  const score = BigInt(Math.max(0, Math.min(100, Math.round(value))));
  const { request } = await publicClient.simulateContract({
    account: platform,
    address: registries.reputation,
    abi: REPUTATION_REGISTRY_ABI,
    functionName: "giveFeedback",
    args: [
      BigInt(erc8004AgentId),
      score,
      0,
      "operator-review",
      categoryTag,
      "",
      "",
      `0x${"0".repeat(64)}` as `0x${string}`,
    ],
  });
  const txHash = await bscWalletClient(platform).writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`tx ${txHash} reverted`);
  return { txHash };
}

export type Erc8004Attestation = {
  requestHash: `0x${string}`;
  requestTx: string;
  responseTx: string;
};

/**
 * Anchor an audit summary on the ValidationRegistry: validationRequest names
 * the platform wallet as validator (sent by the platform as ERC-721 operator —
 * the registry accepts owner, approved-for-all, or per-token approved senders;
 * falls back to the funded agent wallet when the operator grant is missing),
 * then validationResponse(score) from the platform wallet. Both URIs point at
 * the attestation API route, whose body is the exact `summary` string hashed
 * here — so the on-chain keccak256 stays verifiable against the served bytes.
 */
export async function attestAgent(
  deploymentId: string,
  erc8004AgentId: number,
  summary: string,
  attestationId: string,
  score: number,
): Promise<Erc8004Attestation> {
  if (!bscConfigured()) throw new Error("bsc: PLATFORM_BSC_PRIVKEY not configured");
  const registries = erc8004Registries(bscChainId());
  const publicClient = bscPublicClient();
  const platform = platformAccount();
  const agentId = BigInt(erc8004AgentId);
  const hash = keccak256(toBytes(summary));
  const uri = `${appBaseUrl()}/api/agents/attestation/${attestationId}`;
  const response = Math.max(0, Math.min(100, Math.round(score)));

  const isOperator = await publicClient.readContract({
    address: registries.identity,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "isApprovedForAll",
    args: [agentAccount(deploymentId).address, platform.address],
  });
  const requester = isOperator ? platform : agentAccount(deploymentId);

  let requestTx: `0x${string}`;
  try {
    const { request } = await publicClient.simulateContract({
      account: requester,
      address: registries.validation,
      abi: VALIDATION_REGISTRY_ABI,
      functionName: "validationRequest",
      args: [platform.address, agentId, uri, hash],
    });
    requestTx = await bscWalletClient(requester).writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash: requestTx });
  } catch (err) {
    throw new Error(
      `bsc validationRequest: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let responseTx: `0x${string}`;
  try {
    const { request } = await publicClient.simulateContract({
      account: platform,
      address: registries.validation,
      abi: VALIDATION_REGISTRY_ABI,
      functionName: "validationResponse",
      args: [hash, response, uri, hash, "decenchro-audit"],
    });
    responseTx = await bscWalletClient(platform).writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash: responseTx });
  } catch (err) {
    throw new Error(
      `bsc validationResponse: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { requestHash: hash, requestTx, responseTx };
}
