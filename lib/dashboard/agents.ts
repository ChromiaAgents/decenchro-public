import "server-only";

type SdkModule = typeof import("@atbash/sdk");
let sdkPromise: Promise<SdkModule> | null = null;
function loadSdk(): Promise<SdkModule> {
  sdkPromise ??= import("@atbash/sdk");
  return sdkPromise;
}

export type NewAgent = {
  privKey: string;
  pubKey: string;
  fingerprint: string;
};

export type DerivedAgent = {
  valid: boolean;
  pubKey?: string;
  fingerprint?: string;
};

// Validate a user-supplied ATBASH_AGENT_KEY (from the Atbash console) and
// derive its fingerprint so the operator can confirm they pasted the right one.
export async function deriveAgent(key: string): Promise<DerivedAgent> {
  const sdk = await loadSdk();
  const k = (key ?? "").trim();
  try {
    const isValid = (sdk as { isValidPrivateKey?: (k: string) => boolean })
      .isValidPrivateKey;
    if (typeof isValid === "function" && !isValid(k)) return { valid: false };
    const pubKey = sdk.derivePublicKey(k);
    return {
      valid: true,
      pubKey,
      fingerprint: `${pubKey.slice(0, 6)}…${pubKey.slice(-4)}`,
    };
  } catch {
    return { valid: false };
  }
}

// Mint a fresh agent identity (keypair). The agent joins the fleet once a
// Hermes host is deployed with this key as ATBASH_AGENT_KEY and signs its
// first action — this only creates the identity, not the running process.
export async function createAgentIdentity(): Promise<NewAgent> {
  const sdk = await loadSdk();
  const kp = sdk.generateKeyPair() as { privKey: string; pubKey: string };
  return {
    privKey: kp.privKey,
    pubKey: kp.pubKey,
    fingerprint: `${kp.pubKey.slice(0, 6)}…${kp.pubKey.slice(-4)}`,
  };
}
