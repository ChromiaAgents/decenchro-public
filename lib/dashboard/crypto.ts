import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Symmetric encryption for agent secrets at rest (OpenRouter / Telegram tokens,
// the agent's Atbash private key). Ported from the synapse deploy stack.
// Format: `${ivHex}:${tagHex}:${cipherHex}` — AES-256-GCM, authenticated.

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error("ENCRYPTION_KEY must be at least 32 characters");
  }
  return Buffer.from(key.slice(0, 32), "utf8");
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${tag}:${encrypted}`;
}

export function decrypt(ciphertext: string): string {
  const [ivHex, tagHex, encrypted] = ciphertext.split(":");
  if (!ivHex || !tagHex || encrypted == null) {
    throw new Error("malformed ciphertext");
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/** True when ENCRYPTION_KEY is set and long enough — lets routes fail clearly. */
export function encryptionConfigured(): boolean {
  const key = process.env.ENCRYPTION_KEY;
  return Boolean(key && key.length >= 32);
}
