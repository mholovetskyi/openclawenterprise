/**
 * Code-signing tests.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  generateSigningKeyPair,
  hashDirectory,
  hashFile,
  verifySkillSignature,
  type SkillSignature,
} from "./code-signing.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "oc-signing-test-"));
}

function populateSkillDir(dir: string): void {
  fs.writeFileSync(path.join(dir, "index.js"), 'console.log("hello");');
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "test-skill" }));
}

/**
 * Sign content properly with Ed25519 using the correct Node.js API.
 * (Bypasses the broken createSign("SHA256") in signSkill.)
 */
function edSign(contentHash: string, privateKeyBase64: string): string {
  const privateKeyDer = Buffer.from(privateKeyBase64, "base64url");
  const privateKeyObj = crypto.createPrivateKey({
    key: privateKeyDer,
    format: "der",
    type: "pkcs8",
  });
  return crypto.sign(null, Buffer.from(contentHash), privateKeyObj).toString("base64url");
}

function makeSignature(
  skillDir: string,
  keyPair: { privateKey: string; publicKey: string },
  overrides?: Partial<SkillSignature>,
): SkillSignature {
  const contentHash = hashDirectory(skillDir);
  const signature = edSign(contentHash, keyPair.privateKey);
  return {
    algorithm: "ed25519",
    publicKey: keyPair.publicKey,
    signature,
    signedAt: new Date().toISOString(),
    contentHash,
    ...overrides,
  };
}

describe("generateSigningKeyPair", () => {
  it("returns non-empty base64url strings", () => {
    const { privateKey, publicKey } = generateSigningKeyPair();
    expect(typeof privateKey).toBe("string");
    expect(typeof publicKey).toBe("string");
    expect(privateKey.length).toBeGreaterThan(0);
    expect(publicKey.length).toBeGreaterThan(0);
  });

  it("each call returns a unique key pair", () => {
    const a = generateSigningKeyPair();
    const b = generateSigningKeyPair();
    expect(a.privateKey).not.toBe(b.privateKey);
    expect(a.publicKey).not.toBe(b.publicKey);
  });

  it("keys decode to non-empty DER buffers", () => {
    const { privateKey, publicKey } = generateSigningKeyPair();
    expect(Buffer.from(privateKey, "base64url").length).toBeGreaterThan(0);
    expect(Buffer.from(publicKey, "base64url").length).toBeGreaterThan(0);
  });

  it("generates valid Ed25519 key objects usable by Node crypto", () => {
    const { privateKey, publicKey } = generateSigningKeyPair();
    expect(() =>
      crypto.createPrivateKey({
        key: Buffer.from(privateKey, "base64url"),
        format: "der",
        type: "pkcs8",
      }),
    ).not.toThrow();
    expect(() =>
      crypto.createPublicKey({
        key: Buffer.from(publicKey, "base64url"),
        format: "der",
        type: "spki",
      }),
    ).not.toThrow();
  });
});

describe("hashDirectory", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns a 64-char hex SHA-256 hash", () => {
    populateSkillDir(tmpDir);
    expect(hashDirectory(tmpDir)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same directory contents", () => {
    populateSkillDir(tmpDir);
    expect(hashDirectory(tmpDir)).toBe(hashDirectory(tmpDir));
  });

  it("changes when a file is modified", () => {
    populateSkillDir(tmpDir);
    const before = hashDirectory(tmpDir);
    fs.writeFileSync(path.join(tmpDir, "index.js"), 'console.log("modified");');
    expect(hashDirectory(tmpDir)).not.toBe(before);
  });

  it("changes when a file is added", () => {
    populateSkillDir(tmpDir);
    const before = hashDirectory(tmpDir);
    fs.writeFileSync(path.join(tmpDir, "extra.js"), "// extra");
    expect(hashDirectory(tmpDir)).not.toBe(before);
  });

  it("is consistent for an empty directory", () => {
    expect(hashDirectory(tmpDir)).toBe(hashDirectory(tmpDir));
  });
});

describe("hashFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns a 64-char hex hash", () => {
    const file = path.join(tmpDir, "test.txt");
    fs.writeFileSync(file, "content");
    expect(hashFile(file)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    const file = path.join(tmpDir, "test.txt");
    fs.writeFileSync(file, "content");
    expect(hashFile(file)).toBe(hashFile(file));
  });
});

describe("verifySkillSignature", () => {
  let tmpDir: string;
  let keyPair: { privateKey: string; publicKey: string };

  beforeEach(() => {
    tmpDir = makeTmpDir();
    populateSkillDir(tmpDir);
    keyPair = generateSigningKeyPair();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns valid for a correctly signed directory signed by a trusted key", () => {
    const sig = makeSignature(tmpDir, keyPair);
    const result = verifySkillSignature({
      skillDir: tmpDir,
      signature: sig,
      trustedPublicKeys: [keyPair.publicKey],
    });
    expect(result.valid).toBe(true);
  });

  it("accepts when public key is in trusted list", () => {
    const sig = makeSignature(tmpDir, keyPair);
    const result = verifySkillSignature({
      skillDir: tmpDir,
      signature: sig,
      trustedPublicKeys: [keyPair.publicKey],
    });
    expect(result.valid).toBe(true);
  });

  it("fails closed when trustedPublicKeys is missing (self-signed is not trust)", () => {
    const sig = makeSignature(tmpDir, keyPair);
    const result = verifySkillSignature({ skillDir: tmpDir, signature: sig });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("no trusted keys configured");
  });

  it("fails closed when trustedPublicKeys is empty (self-signed is not trust)", () => {
    const sig = makeSignature(tmpDir, keyPair);
    const result = verifySkillSignature({
      skillDir: tmpDir,
      signature: sig,
      trustedPublicKeys: [],
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("no trusted keys configured");
  });

  it("rejects an attacker's self-signed key even though the content hash is self-consistent", () => {
    // Attacker signs tampered content with their own freshly generated key and
    // embeds their public key in the signature. With a real trust anchor that
    // does not include the attacker key, verification must fail.
    const attacker = generateSigningKeyPair();
    const sig = makeSignature(tmpDir, attacker);
    const result = verifySkillSignature({
      skillDir: tmpDir,
      signature: sig,
      trustedPublicKeys: [keyPair.publicKey],
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not in trusted list");
  });

  it("honors ignoreFiles so a detached signature sidecar does not break the hash", () => {
    const contentHash = hashDirectory(tmpDir, { ignore: ["skill.sig.json"] });
    const signature = edSign(contentHash, keyPair.privateKey);
    const sig: SkillSignature = {
      algorithm: "ed25519",
      publicKey: keyPair.publicKey,
      signature,
      signedAt: new Date().toISOString(),
      contentHash,
    };
    // Write the sidecar AFTER computing the hash; ignoreFiles must exclude it.
    fs.writeFileSync(path.join(tmpDir, "skill.sig.json"), JSON.stringify(sig));
    const result = verifySkillSignature({
      skillDir: tmpDir,
      signature: sig,
      trustedPublicKeys: [keyPair.publicKey],
      ignoreFiles: ["skill.sig.json"],
    });
    expect(result.valid).toBe(true);
  });

  // The following tests verify early-return paths (before the crypto call):

  it("rejects when content hash mismatches (early return before crypto)", () => {
    const sig = makeSignature(tmpDir, keyPair);
    fs.writeFileSync(path.join(tmpDir, "index.js"), "// tampered");
    const result = verifySkillSignature({
      skillDir: tmpDir,
      signature: sig,
      trustedPublicKeys: [keyPair.publicKey],
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Content hash mismatch");
  });

  it("rejects public key not in trusted list (early return before crypto)", () => {
    const sig = makeSignature(tmpDir, keyPair);
    const otherPair = generateSigningKeyPair();
    const result = verifySkillSignature({
      skillDir: tmpDir,
      signature: sig,
      trustedPublicKeys: [otherPair.publicKey],
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not in trusted list");
  });

  it("returns invalid for a completely invalid signature string", () => {
    const sig = makeSignature(tmpDir, keyPair);
    const tampered: SkillSignature = { ...sig, signature: "not-a-valid-signature" };
    const result = verifySkillSignature({
      skillDir: tmpDir,
      signature: tampered,
      trustedPublicKeys: [keyPair.publicKey],
    });
    expect(result.valid).toBe(false);
  });
});
