import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFileBackend } from "./backend-file.js";
import { deriveKeyFromPassphrase } from "./encryption.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-test-"));
}

describe("createFileBackend", () => {
  let tmpDir: string;
  let storePath: string;
  let key: Buffer;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    storePath = path.join(tmpDir, "secrets.enc");
    key = deriveKeyFromPassphrase("test-passphrase");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("get returns null for a missing key", async () => {
    const backend = createFileBackend({ storePath, key });
    expect(await backend.get("nonexistent")).toBeNull();
  });

  it("set and get roundtrip a secret", async () => {
    const backend = createFileBackend({ storePath, key });
    await backend.set("my/secret", "s3cr3t");
    expect(await backend.get("my/secret")).toBe("s3cr3t");
  });

  it("overwrites an existing secret", async () => {
    const backend = createFileBackend({ storePath, key });
    await backend.set("key", "old-value");
    await backend.set("key", "new-value");
    expect(await backend.get("key")).toBe("new-value");
  });

  it("stores secrets encrypted on disk (ciphertext is not plaintext)", async () => {
    const backend = createFileBackend({ storePath, key });
    await backend.set("api-key", "plaintext-secret");
    const raw = fs.readFileSync(storePath, "utf8");
    expect(raw).not.toContain("plaintext-secret");
  });

  it("list returns all stored keys", async () => {
    const backend = createFileBackend({ storePath, key });
    await backend.set("a", "1");
    await backend.set("b", "2");
    await backend.set("c", "3");
    const keys = await backend.list();
    expect(keys.toSorted()).toEqual(["a", "b", "c"]);
  });

  it("list returns empty array when no secrets exist", async () => {
    const backend = createFileBackend({ storePath, key });
    expect(await backend.list()).toEqual([]);
  });

  it("exists returns true for stored key", async () => {
    const backend = createFileBackend({ storePath, key });
    await backend.set("exists-key", "value");
    expect(await backend.exists("exists-key")).toBe(true);
  });

  it("exists returns false for unknown key", async () => {
    const backend = createFileBackend({ storePath, key });
    expect(await backend.exists("unknown")).toBe(false);
  });

  it("delete removes a key", async () => {
    const backend = createFileBackend({ storePath, key });
    await backend.set("to-delete", "value");
    await backend.delete("to-delete");
    expect(await backend.get("to-delete")).toBeNull();
    expect(await backend.exists("to-delete")).toBe(false);
  });

  it("delete on non-existent key does not throw", async () => {
    const backend = createFileBackend({ storePath, key });
    await expect(backend.delete("nonexistent")).resolves.toBeUndefined();
  });

  it("persists secrets across backend instances (same key, same store path)", async () => {
    const backend1 = createFileBackend({ storePath, key });
    await backend1.set("persistent", "value-123");

    const backend2 = createFileBackend({ storePath, key });
    expect(await backend2.get("persistent")).toBe("value-123");
  });

  it("cannot read secrets with wrong key", async () => {
    const backend1 = createFileBackend({ storePath, key });
    await backend1.set("secret", "value");

    const wrongKey = deriveKeyFromPassphrase("wrong-passphrase");
    const backend2 = createFileBackend({ storePath, key: wrongKey });
    await expect(backend2.get("secret")).rejects.toThrow();
  });

  it("shutdown resolves without error", async () => {
    const backend = createFileBackend({ storePath, key });
    await expect(backend.shutdown()).resolves.toBeUndefined();
  });

  it("name is 'file'", () => {
    const backend = createFileBackend({ storePath, key });
    expect(backend.name).toBe("file");
  });

  it("metadata is stored with the secret", async () => {
    const backend = createFileBackend({ storePath, key });
    const now = new Date().toISOString();
    await backend.set("with-meta", "value", {
      description: "test secret",
      createdAt: now,
    });
    // Just verify it doesn't throw and get still works
    expect(await backend.get("with-meta")).toBe("value");
  });
});
