/**
 * AES-256-GCM encryption helpers for secret storage.
 * Uses a 256-bit key, random 96-bit IV, and a 128-bit auth tag.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

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

/** scrypt cost parameters (CPU/memory hard). N must be a power of two. */
const SCRYPT_N = 1 << 15; // 32768
const SCRYPT_R = 8;
const SCRYPT_P = 1;
// 128 * N * r ≈ 33 MiB of working memory; the default 32 MiB maxmem would
// reject this, so raise the ceiling explicitly.
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

/** Recommended salt length for {@link deriveKeyFromPassphrase}. */
export const KDF_SALT_BYTES = 16;

/**
 * Generate a fresh random salt for passphrase-based key derivation.
 * Persist this alongside any ciphertext so the key can be re-derived.
 */
export function generateKdfSalt(): Buffer {
  return randomBytes(KDF_SALT_BYTES);
}

/**
 * Derive a 256-bit AES key from a passphrase using scrypt (salted, memory-hard).
 *
 * A per-secret random salt is REQUIRED — generate one with
 * {@link generateKdfSalt} and store it next to the ciphertext so decryption can
 * re-derive the same key. Deriving without a salt (or reusing a global salt)
 * would make the output trivially rainbow-tableable, so the salt is mandatory.
 */
export function deriveKeyFromPassphrase(passphrase: string, salt: Buffer): Buffer {
  if (!Buffer.isBuffer(salt) || salt.length < KDF_SALT_BYTES) {
    throw new Error(`deriveKeyFromPassphrase requires a salt of at least ${KDF_SALT_BYTES} bytes`);
  }
  return scryptSync(passphrase, salt, 32, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
}
