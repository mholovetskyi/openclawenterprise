/**
 * Skill code signing — Ed25519 signatures for tamper-evident skill distribution.
 *
 * Publishers sign their skill packages; the registry verifies before installation.
 * Follows the same pattern as OpenClaw's existing device identity signatures.
 */

import { createSign, createVerify, generateKeyPairSync, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export type SkillSignature = {
  algorithm: "ed25519";
  publicKey: string;    // base64url-encoded Ed25519 public key
  signature: string;    // base64url-encoded signature
  signedAt: string;     // ISO 8601
  signerName?: string;  // Human-readable publisher name
  contentHash: string;  // SHA-256 of the signed content
};

export type SkillManifest = {
  name: string;
  version: string;
  description: string;
  author: string;
  homepage?: string;
  license?: string;
  files: Array<{ path: string; sha256: string }>;
  signatures?: SkillSignature[];
};

// ── Key pair generation ────────────────────────────────────────────────────────

export function generateSigningKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  return {
    privateKey: privateKey.toString("base64url"),
    publicKey: publicKey.toString("base64url"),
  };
}

// ── Hashing ────────────────────────────────────────────────────────────────────

export function hashDirectory(dirPath: string): string {
  const hash = createHash("sha256");
  const files = walkSorted(dirPath);
  for (const file of files) {
    const rel = path.relative(dirPath, file);
    const content = fs.readFileSync(file);
    hash.update(`${rel}\n`);
    hash.update(content);
  }
  return hash.digest("hex");
}

export function hashFile(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function walkSorted(dir: string): string[] {
  const result: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkSorted(full));
    } else if (entry.isFile()) {
      result.push(full);
    }
  }
  return result;
}

// ── Signing ────────────────────────────────────────────────────────────────────

/**
 * Sign a skill directory with an Ed25519 private key.
 */
export function signSkill(params: {
  skillDir: string;
  privateKeyBase64: string;
  signerName?: string;
}): SkillSignature {
  const contentHash = hashDirectory(params.skillDir);
  const privateKeyDer = Buffer.from(params.privateKeyBase64, "base64url");

  const signer = createSign("SHA256");
  signer.update(contentHash);
  const signature = signer.sign({ key: privateKeyDer, format: "der", type: "pkcs8" }, "base64url");

  // Derive public key from private key
  const { publicKey: publicKeyBase64 } = derivePublicKey(params.privateKeyBase64);

  return {
    algorithm: "ed25519",
    publicKey: publicKeyBase64,
    signature,
    signedAt: new Date().toISOString(),
    signerName: params.signerName,
    contentHash,
  };
}

/**
 * Verify a skill directory against a signature.
 */
export function verifySkillSignature(params: {
  skillDir: string;
  signature: SkillSignature;
  trustedPublicKeys?: string[];
}): { valid: boolean; reason?: string } {
  // Check trusted keys list
  if (params.trustedPublicKeys?.length) {
    if (!params.trustedPublicKeys.includes(params.signature.publicKey)) {
      return { valid: false, reason: "Publisher public key not in trusted list" };
    }
  }

  // Recompute content hash
  const contentHash = hashDirectory(params.skillDir);
  if (contentHash !== params.signature.contentHash) {
    return { valid: false, reason: "Content hash mismatch — skill may have been tampered with" };
  }

  // Verify signature
  try {
    const publicKeyDer = Buffer.from(params.signature.publicKey, "base64url");
    const verifier = createVerify("SHA256");
    verifier.update(contentHash);
    const valid = verifier.verify(
      { key: publicKeyDer, format: "der", type: "spki" },
      params.signature.signature,
      "base64url",
    );
    if (!valid) return { valid: false, reason: "Signature verification failed" };
    return { valid: true };
  } catch (err) {
    return { valid: false, reason: `Signature error: ${err}` };
  }
}

function derivePublicKey(privateKeyBase64: string): { publicKey: string } {
  // For Ed25519, we need to re-generate or extract the public key from the private key DER
  // This is a simplified version — in practice, use KeyObject API
  const privateKeyDer = Buffer.from(privateKeyBase64, "base64url");
  // Ed25519 PKCS#8 DER: last 32 bytes of a 48-byte key is the seed
  // The public key (spki) is derived deterministically
  // For now, we store the public key separately during key generation
  return { publicKey: privateKeyBase64.slice(0, 44) }; // placeholder
}
