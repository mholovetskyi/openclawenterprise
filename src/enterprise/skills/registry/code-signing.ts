/**
 * Skill code signing — Ed25519 signatures for tamper-evident skill distribution.
 *
 * Publishers sign their skill packages; the registry verifies before installation.
 * Follows the same pattern as OpenClaw's existing device identity signatures.
 */

import { generateKeyPairSync, sign, verify, createPrivateKey, createPublicKey } from "node:crypto";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type SkillSignature = {
  algorithm: "ed25519";
  publicKey: string; // base64url-encoded Ed25519 public key
  signature: string; // base64url-encoded signature
  signedAt: string; // ISO 8601
  signerName?: string; // Human-readable publisher name
  contentHash: string; // SHA-256 of the signed content
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
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
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

  const privateKeyObj = createPrivateKey({ key: privateKeyDer, format: "der", type: "pkcs8" });
  const signature = sign(null, Buffer.from(contentHash), privateKeyObj).toString("base64url");

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
    const publicKeyObj = createPublicKey({ key: publicKeyDer, format: "der", type: "spki" });
    const valid = verify(
      null,
      Buffer.from(contentHash),
      publicKeyObj,
      Buffer.from(params.signature.signature, "base64url"),
    );
    if (!valid) return { valid: false, reason: "Signature verification failed" };
    return { valid: true };
  } catch (err) {
    return { valid: false, reason: `Signature error: ${err}` };
  }
}

function derivePublicKey(privateKeyBase64: string): { publicKey: string } {
  const privateKeyDer = Buffer.from(privateKeyBase64, "base64url");
  const privateKeyObj = createPrivateKey({ key: privateKeyDer, format: "der", type: "pkcs8" });
  const publicKeyObj = createPublicKey(privateKeyObj);
  const publicKeyDer = publicKeyObj.export({ type: "spki", format: "der" }) as Buffer;
  return { publicKey: publicKeyDer.toString("base64url") };
}
