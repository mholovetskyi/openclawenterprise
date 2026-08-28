import { describe, it, expect, vi, afterEach } from "vitest";
import { createEnvBackend } from "./backend-env.js";

describe("createEnvBackend", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("name is 'env'", () => {
    expect(createEnvBackend().name).toBe("env");
  });

  it("get reads from process.env", async () => {
    vi.stubEnv("ENV_BACKEND_TEST", "from-env");
    const backend = createEnvBackend();
    expect(await backend.get("ENV_BACKEND_TEST")).toBe("from-env");
  });

  it("get returns null for an unset variable", async () => {
    delete process.env.ENV_BACKEND_MISSING;
    const backend = createEnvBackend();
    expect(await backend.get("ENV_BACKEND_MISSING")).toBeNull();
  });

  it("exists reflects presence in process.env", async () => {
    vi.stubEnv("ENV_BACKEND_PRESENT", "x");
    const backend = createEnvBackend();
    expect(await backend.exists("ENV_BACKEND_PRESENT")).toBe(true);
    expect(await backend.exists("ENV_BACKEND_ABSENT_XYZ")).toBe(false);
  });

  it("set throws (read-only, never persists to disk)", async () => {
    await expect(createEnvBackend().set("K", "v")).rejects.toThrow("read-only");
  });

  it("delete throws (read-only)", async () => {
    await expect(createEnvBackend().delete("K")).rejects.toThrow("read-only");
  });

  it("list returns empty array (does not enumerate the environment)", async () => {
    vi.stubEnv("ENV_BACKEND_SOME_SECRET", "leaky");
    expect(await createEnvBackend().list()).toEqual([]);
  });

  it("shutdown resolves without error", async () => {
    await expect(createEnvBackend().shutdown()).resolves.toBeUndefined();
  });
});
