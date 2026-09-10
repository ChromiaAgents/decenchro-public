// Read-only ERC-8004 registry smoke check. Run from the repo root:
//   node scripts/check-erc8004.mjs            (BSC testnet, 97)
//   BSC_CHAIN_ID=56 node scripts/check-erc8004.mjs
//
// Asserts: the RPC answers with the expected chain id, all three registries
// have bytecode, register(string) simulates from a throwaway account (state
// override free — eth_call, no gas, no key material), and the reputation
// getSummary view answers. Exits 1 on the first failure so it can gate a
// deploy.

import assert from "node:assert/strict";

import { createPublicClient, defineChain, http } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const chainId = Number.parseInt(process.env.BSC_CHAIN_ID ?? "97", 10);
const rpc =
  process.env.BSC_RPC_URL ||
  (chainId === 56
    ? "https://bsc-rpc.publicnode.com"
    : "https://bsc-testnet-rpc.publicnode.com");

// Mirror lib/dashboard/erc8004-abi.ts (this script stays dependency-light and
// runnable without the Next build).
const REGISTRIES =
  chainId === 56
    ? {
        identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
        reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
        validation: "0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58",
      }
    : {
        identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
        reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
        validation: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
      };

const IDENTITY_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
];
const REPUTATION_ABI = [
  {
    type: "function",
    name: "getSummary",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "clientAddresses", type: "address[]" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
    ],
    outputs: [
      { name: "count", type: "uint64" },
      { name: "summaryValue", type: "int128" },
      { name: "summaryValueDecimals", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "getClients",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ type: "address[]" }],
  },
];

const client = createPublicClient({
  chain: defineChain({
    id: chainId,
    name: `bsc-${chainId}`,
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  }),
  transport: http(rpc),
});

const live = await client.getChainId();
assert.equal(live, chainId, `RPC ${rpc} answers chain ${live}, expected ${chainId}`);
console.log(`ok chainId ${live} via ${rpc}`);

for (const [name, address] of Object.entries(REGISTRIES)) {
  const code = await client.getCode({ address });
  assert.ok(code && code !== "0x", `${name} registry has no code at ${address}`);
  console.log(`ok ${name.padEnd(10)} ${address} code ${code.length / 2 - 1} bytes`);
}

const throwaway = privateKeyToAccount(generatePrivateKey());
const sim = await client.simulateContract({
  account: throwaway,
  address: REGISTRIES.identity,
  abi: IDENTITY_ABI,
  functionName: "register",
  args: ["https://example.com/card.json"],
});
assert.ok(typeof sim.result === "bigint" && sim.result > 0n, "register simulation returned no agentId");
console.log(`ok register(string) simulates — next agentId would be ${sim.result}`);

// Live-contract gotcha: getSummary REVERTS on an empty clientAddresses array
// ("clientAddresses required") — always resolve clients via getClients first.
const clients = await client.readContract({
  address: REGISTRIES.reputation,
  abi: REPUTATION_ABI,
  functionName: "getClients",
  args: [1n],
});
if (clients.length === 0) {
  console.log("ok reputation getClients(agentId 1) → no feedback clients yet");
} else {
  const summary = await client.readContract({
    address: REGISTRIES.reputation,
    abi: REPUTATION_ABI,
    functionName: "getSummary",
    args: [1n, clients.slice(0, 50), "", ""],
  });
  console.log(
    `ok reputation getSummary(agentId 1) → count=${summary[0]} value=${summary[1]}`,
  );
}

console.log("erc-8004 smoke: all green");
