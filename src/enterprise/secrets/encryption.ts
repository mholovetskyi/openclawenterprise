/**
 * AES-256-GCM encryption helpers for secret storage.
 * Uses a 256-bit key, random 96-bit IV, and a 128-bit auth tag.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

const ALGORITHM = "aes-256-gcm" as const;
const IV_BYTES = 12; // 96-bit IV for GCM
const TAG_BYTES = 16; // 128-bit auth tag
const VERSION_BYTE = 0x01;

export type EncryptedBlob = {
  /** Base64-encoded ciphertext envelope: version|iv|tag|ciphertext */
  data: string;
  /** ISO 8601 timestamp of when this blob was created */
  createdAt: string;
};

/**
 * Encrypt plaintext with AES-256-GCM.
 * Returns a base64-encoded envelope: [version(1)] [iv(12)] [tag(16)] [ciphertext(n)]
 */
export function encrypt(plaintext: string, key: Buffer): EncryptedBlob {
  if (key.length !== 32) {
    throw new Error(`encryption key must be 32 bytes, got ${key.length}`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Envelope: version(1) | iv(12) | tag(16) | ciphertext(n)
  const envelope = Buffer.concat([Buffer.from([VERSION_BYTE]), iv, tag, encrypted]);

  return {
    data: envelope.toString("base64"),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Decrypt a blob produced by `encrypt()`.
 */
export function decrypt(blob: EncryptedBlob, key: Buffer): string {
  if (key.length !== 32) {
    throw new Error(`decryption key must be 32 bytes, got ${key.length}`);
  }
  const envelope = Buffer.from(blob.data, "base64");
  const minLen = 1 + IV_BYTES + TAG_BYTES;
  if (envelope.length < minLen) {
    throw new Error("encrypted blob is too short");
  }

  const version = envelope[0];
  if (version !== VERSION_BYTE) {
    throw new Error(`unsupported encryption version: ${version}`);
  }

  const iv = envelope.subarray(1, 1 + IV_BYTES);
  const tag = envelope.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = envelope.subarray(1 + IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("decryption failed — wrong key or tampered data");
  }
}

/**
 * Derive a 256-bit key from a passphrase using SHA-256.
 * For stronger KDFs see key-derivation.ts (Argon2id / PBKDF2).
 */
export function deriveKeyFromPassphrase(passphrase: string): Buffer {
  return createHash("sha256").update(passphrase).digest();
}
