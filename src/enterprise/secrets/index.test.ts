import { describe, it, expect, vi } from "vitest";
import { parseSecretRef, resolveSecretValue } from "./index.js";

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
