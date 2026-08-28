import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { encrypt, decrypt, deriveKeyFromPassphrase } from "./encryption.js";

const key32 = Buffer.alloc(32, 0xab); // 32-byte key

describe("encrypt", () => {
  it("returns a base64 blob with a createdAt ISO timestamp", () => {
    const blob = encrypt("hello", key32);
    expect(typeof blob.data).toBe("string");
    expect(() => Buffer.from(blob.data, "base64")).not.toThrow();
    expect(blob.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("throws when key is not 32 bytes", () => {
    const badKey = Buffer.alloc(16);
    expect(() => encrypt("hello", badKey)).toThrow("32 bytes");
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    const a = encrypt("same", key32);
    const b = encrypt("same", key32);
    expect(a.data).not.toBe(b.data);
  });

  it("envelope is at least 1+12+16 bytes (version+iv+tag)", () => {
    const blob = encrypt("x", key32);
    const buf = Buffer.from(blob.data, "base64");
    expect(buf.length).toBeGreaterThanOrEqual(29);
  });
});

describe("decrypt", () => {
  it("roundtrips plaintext through encrypt/decrypt", () => {
    const plaintext = "super-secret-value";
    const blob = encrypt(plaintext, key32);
    expect(decrypt(blob, key32)).toBe(plaintext);
  });

  it("roundtrips empty string", () => {
    const blob = encrypt("", key32);
    expect(decrypt(blob, key32)).toBe("");
  });

  it("roundtrips unicode content", () => {
    const text = "тест 🔐 中文";
    const blob = encrypt(text, key32);
    expect(decrypt(blob, key32)).toBe(text);
  });

  it("throws when key is not 32 bytes", () => {
    const blob = encrypt("hello", key32);
    expect(() => decrypt(blob, Buffer.alloc(16))).toThrow("32 bytes");
  });

  it("throws on wrong key (authentication failure)", () => {
    const blob = encrypt("hello", key32);
    const wrongKey = Buffer.alloc(32, 0x11);
    expect(() => decrypt(blob, wrongKey)).toThrow("decryption failed");
  });

  it("throws on tampered ciphertext", () => {
    const blob = encrypt("hello", key32);
    const buf = Buffer.from(blob.data, "base64");
    // Flip a byte in the ciphertext area (after version+iv+tag = 29 bytes)
    buf[29] = buf[29]! ^ 0xff;
    const tampered = { data: buf.toString("base64"), createdAt: blob.createdAt };
    expect(() => decrypt(tampered, key32)).toThrow("decryption failed");
  });

  it("throws when blob is too short", () => {
    const tiny = { data: Buffer.from([0x01]).toString("base64"), createdAt: "" };
    expect(() => decrypt(tiny, key32)).toThrow("too short");
  });

  it("throws on unsupported version byte", () => {
    const blob = encrypt("hello", key32);
    const buf = Buffer.from(blob.data, "base64");
    buf[0] = 0x99; // corrupt version byte
    const bad = { data: buf.toString("base64"), createdAt: blob.createdAt };
    expect(() => decrypt(bad, key32)).toThrow("unsupported encryption version");
  });
});

describe("deriveKeyFromPassphrase", () => {
  const salt = Buffer.alloc(16, 0x5a);

  it("returns a 32-byte Buffer", () => {
    const key = deriveKeyFromPassphrase("my-passphrase", salt);
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
  });

  it("is deterministic for the same passphrase and salt", () => {
    const a = deriveKeyFromPassphrase("pass", salt);
    const b = deriveKeyFromPassphrase("pass", salt);
    expect(a.toString("hex")).toBe(b.toString("hex"));
  });

  it("produces different keys for different passphrases", () => {
    const a = deriveKeyFromPassphrase("foo", salt);
    const b = deriveKeyFromPassphrase("bar", salt);
    expect(a.toString("hex")).not.toBe(b.toString("hex"));
  });

  it("produces different keys for different salts (salted KDF)", () => {
    const a = deriveKeyFromPassphrase("same", Buffer.alloc(16, 0x01));
    const b = deriveKeyFromPassphrase("same", Buffer.alloc(16, 0x02));
    expect(a.toString("hex")).not.toBe(b.toString("hex"));
  });

  it("is not a bare SHA-256 of the passphrase (uses a real KDF)", () => {
    const sha = createHash("sha256").update("pass").digest();
    const derived = deriveKeyFromPassphrase("pass", salt);
    expect(derived.toString("hex")).not.toBe(sha.toString("hex"));
  });

  it("throws when the salt is missing or too short", () => {
    expect(() => (deriveKeyFromPassphrase as unknown as (p: string) => Buffer)("pass")).toThrow(
      "salt",
    );
    expect(() => deriveKeyFromPassphrase("pass", Buffer.alloc(4))).toThrow("salt");
  });

  it("derived key works for encrypt/decrypt", () => {
    const key = deriveKeyFromPassphrase("my-secure-passphrase", salt);
    const blob = encrypt("secret", key);
    expect(decrypt(blob, key)).toBe("secret");
  });
});
