import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import {
  parseSecretRef,
  resolveSecretValue,
  initSecretsBackend,
  type SecretsHandle,
} from "./index.js";

function cfgWith(secrets: Record<string, unknown>): OpenClawConfig {
  // SAFETY: initSecretsBackend only reads cfg.enterprise.secrets; a minimal
  // object covering that path is sufficient for these tests.
  return { enterprise: { secrets } } as unknown as OpenClawConfig;
}

describe("parseSecretRef", () => {
  it("parses plain values with no scheme", () => {
    const ref = parseSecretRef("plaintext-value");
    expect(ref.scheme).toBe("plain");
    expect(ref.path).toBe("plaintext-value");
    expect(ref.field).toBeUndefined();
  });

  it("parses vault:// scheme", () => {
    const ref = parseSecretRef("vault://secret/openclaw/openai");
    expect(ref.scheme).toBe("vault");
    expect(ref.path).toBe("secret/openclaw/openai");
    expect(ref.field).toBeUndefined();
  });

  it("parses vault:// with field fragment", () => {
    const ref = parseSecretRef("vault://secret/openclaw/openai#api_key");
    expect(ref.scheme).toBe("vault");
    expect(ref.path).toBe("secret/openclaw/openai");
    expect(ref.field).toBe("api_key");
  });

  it("parses aws-sm:// scheme", () => {
    const ref = parseSecretRef("aws-sm://openclaw/openai-key");
    expect(ref.scheme).toBe("aws-sm");
    expect(ref.path).toBe("openclaw/openai-key");
  });

  it("parses gcp-sm:// scheme", () => {
    const ref = parseSecretRef("gcp-sm://projects/123/secrets/my-key");
    expect(ref.scheme).toBe("gcp-sm");
    expect(ref.path).toBe("projects/123/secrets/my-key");
  });

  it("parses azure-kv:// scheme", () => {
    const ref = parseSecretRef("azure-kv://my-vault/secrets/openai");
    expect(ref.scheme).toBe("azure-kv");
    expect(ref.path).toBe("my-vault/secrets/openai");
  });

  it("parses env:// scheme", () => {
    const ref = parseSecretRef("env://OPENAI_API_KEY");
    expect(ref.scheme).toBe("env");
    expect(ref.path).toBe("OPENAI_API_KEY");
  });

  it("parses encrypted:// scheme", () => {
    const ref = parseSecretRef("encrypted://base64blobdata");
    expect(ref.scheme).toBe("encrypted");
    expect(ref.path).toBe("base64blobdata");
  });

  it("handles URL with multiple slashes in path", () => {
    const ref = parseSecretRef("vault://kv/v2/data/my/nested/secret#key");
    expect(ref.scheme).toBe("vault");
    expect(ref.path).toBe("kv/v2/data/my/nested/secret");
    expect(ref.field).toBe("key");
  });

  it("treats values without :// as plain", () => {
    expect(parseSecretRef("not-a-url").scheme).toBe("plain");
    expect(parseSecretRef("").scheme).toBe("plain");
    expect(parseSecretRef("localhost:8080").scheme).toBe("plain");
  });
});

describe("resolveSecretValue — plain", () => {
  it("returns plain values as-is", async () => {
    const result = await resolveSecretValue("my-api-key");
    expect(result).toBe("my-api-key");
  });
});

describe("resolveSecretValue — env://", () => {
  it("resolves env:// from process.env", async () => {
    vi.stubEnv("TEST_RESOLVE_VAR", "resolved-env-value");
    const result = await resolveSecretValue("env://TEST_RESOLVE_VAR");
    expect(result).toBe("resolved-env-value");
    vi.unstubAllEnvs();
  });

  it("throws when env var is not set", async () => {
    vi.stubEnv("MISSING_VAR_XYZ", undefined as unknown as string);
    delete process.env.MISSING_VAR_XYZ;
    await expect(resolveSecretValue("env://MISSING_VAR_XYZ")).rejects.toThrow(
      "environment variable not set",
    );
    vi.unstubAllEnvs();
  });
});

describe("resolveSecretValue — backend required schemes", () => {
  it("throws when no backend is initialized for vault:// reference", async () => {
    // activeBackend is module-level; without initialization it's null
    await expect(resolveSecretValue("vault://secret/path")).rejects.toThrow(
      "Secret backend not initialized",
    );
  });
});

describe("initSecretsBackend — backend selection", () => {
  let handle: SecretsHandle | null = null;
  let tmpDir: string;

  afterEach(async () => {
    if (handle) {
      await handle.shutdown();
      handle = null;
    }
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('backend "env" installs a read-only env backend (no disk writes)', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-env-"));
    handle = await initSecretsBackend(cfgWith({ backend: "env" }));
    expect(handle.backend.name).toBe("env");
    vi.stubEnv("SECRETS_ENV_BACKEND_VAR", "container-secret");
    expect(await resolveSecretValue("env://SECRETS_ENV_BACKEND_VAR")).toBe("container-secret");
    // No master-key file is minted for the env backend.
    expect(fs.existsSync(path.join(tmpDir, ".master-key"))).toBe(false);
    await expect(handle.backend.set("k", "v")).rejects.toThrow("read-only");
  });

  it('backend "none" throws instead of falling through to the file backend', async () => {
    await expect(initSecretsBackend(cfgWith({ backend: "none" }))).rejects.toThrow(
      "no secret backend configured",
    );
  });

  it("throws on a malformed OPENCLAW_MASTER_KEY instead of minting a replacement", async () => {
    if (process.platform === "darwin") return; // keychain may pre-empt the env var
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-mk-"));
    vi.stubEnv("OPENCLAW_MASTER_KEY", "too-short-not-32-bytes");
    await expect(
      initSecretsBackend(cfgWith({ backend: "file", filePath: path.join(tmpDir, "secrets.enc") })),
    ).rejects.toThrow("must be a base64-encoded 32-byte key");
  });

  it("encrypted:// to a missing secret fails closed (throws, not empty string)", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-enc-"));
    vi.stubEnv("OPENCLAW_MASTER_KEY", Buffer.alloc(32, 7).toString("base64"));
    handle = await initSecretsBackend(
      cfgWith({ backend: "file", filePath: path.join(tmpDir, "secrets.enc") }),
    );
    await expect(resolveSecretValue("encrypted://never-stored")).rejects.toThrow(
      "Secret not found",
    );
  });
});
