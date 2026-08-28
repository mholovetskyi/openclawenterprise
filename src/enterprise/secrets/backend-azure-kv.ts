/**
 * Azure Key Vault backend.
 *
 * Requires: npm install @azure/keyvault-secrets @azure/identity
 * Auth: DefaultAzureCredential (env vars, managed identity, VS Code, CLI)
 *
 * Config reference:
 *   enterprise.secrets.backend: azure-kv
 *   enterprise.secrets.azureKv:
 *     vaultUrl: https://my-vault.vault.azure.net   # required
 *     prefix: openclaw-                             # optional name prefix
 */

import type { OpenClawConfig } from "../../config/config.js";
import type { SecretBackend } from "./index.js";

// ── Minimal structural types for @azure/keyvault-secrets ─────────────────────
// The package is an optional dependency (zero-dep policy for enterprise
// backends): it is lazy-loaded at runtime, and these local interfaces cover
// only the pieces this backend uses so the file typechecks without it.

type AzureSecretClient = {
  getSecret(name: string): Promise<{ value?: string }>;
  setSecret(
    name: string,
    value: string,
    options?: { tags?: Record<string, string> },
  ): Promise<unknown>;
  beginDeleteSecret(name: string): Promise<{ pollUntilDone(): Promise<unknown> }>;
  listPropertiesOfSecrets(): AsyncIterable<{ name?: string; enabled?: boolean }>;
};

type AzureKeyVaultModule = {
  SecretClient: new (vaultUrl: string, credential: unknown) => AzureSecretClient;
};

// Widened to `string` so the compiler does not try to resolve the optional
// package's type declarations at the dynamic import site below.
const AZURE_KV_MODULE: string = "@azure/keyvault-secrets";

export async function createAzureKeyVaultBackend(cfg: OpenClawConfig): Promise<SecretBackend> {
  const azCfg = cfg.enterprise?.secrets?.azureKv as
    | { vaultUrl: string; prefix?: string }
    | undefined;

  if (!azCfg?.vaultUrl) {
    throw new Error("enterprise.secrets.azureKv.vaultUrl is required for azure-kv backend");
  }

  const vaultUrl = azCfg.vaultUrl;
  const prefix = azCfg.prefix ?? "";

  // Lazy imports
  const [{ SecretClient }, { DefaultAzureCredential }] = await Promise.all([
    (import(AZURE_KV_MODULE) as Promise<AzureKeyVaultModule>).catch(() => {
      throw new Error(
        "Package @azure/keyvault-secrets is not installed.\n" +
          "Run: npm install @azure/keyvault-secrets @azure/identity",
      );
    }),
    import("@azure/identity").catch(() => {
      throw new Error(
        "Package @azure/identity is not installed.\n" +
          "Run: npm install @azure/keyvault-secrets @azure/identity",
      );
    }),
  ]);

  const credential = new DefaultAzureCredential();
  const client = new SecretClient(vaultUrl, credential);

  return {
    name: "azure-kv" as const,

    async exists(key: string): Promise<boolean> {
      const name = encodeAzureName(prefix + key);
      try {
        await client.getSecret(name);
        return true;
      } catch (err: unknown) {
        if (isNotFoundError(err)) return false;
        throw err;
      }
    },

    async get(key: string): Promise<string | null> {
      const name = encodeAzureName(prefix + key);
      try {
        const secret = await client.getSecret(name);
        return secret.value ?? null;
      } catch (err: unknown) {
        if (isNotFoundError(err)) return null;
        throw err;
      }
    },

    async set(key: string, value: string): Promise<void> {
      const name = encodeAzureName(prefix + key);
      await client.setSecret(name, value, {
        tags: { "managed-by": "openclaw" },
      });
    },

    async delete(key: string): Promise<void> {
      const name = encodeAzureName(prefix + key);
      try {
        const poller = await client.beginDeleteSecret(name);
        await poller.pollUntilDone();
      } catch (err: unknown) {
        if (isNotFoundError(err)) return;
        throw err;
      }
    },

    async list(keyPrefix?: string): Promise<string[]> {
      const names: string[] = [];
      const props = client.listPropertiesOfSecrets();
      for await (const secret of props) {
        if (!secret.name) continue;
        const decoded = decodeAzureName(secret.name);
        // Strip backend prefix
        const stripped = prefix ? decoded.replace(new RegExp(`^${prefix}`), "") : decoded;
        if (keyPrefix && !stripped.startsWith(keyPrefix)) continue;
        // Skip deleted secrets
        if (secret.enabled === false) continue;
        names.push(stripped);
      }
      return names;
    },

    async shutdown(): Promise<void> {
      // Azure SDK clients don't require explicit cleanup
    },
  };
}

// Azure Key Vault secret names allow [a-zA-Z0-9-]
// Map other chars (slashes, dots, underscores) to double-dash prefix + hex
function encodeAzureName(key: string): string {
  return key.replace(/[^a-zA-Z0-9-]/g, (c) => `--${c.codePointAt(0)!.toString(16)}-`);
}

function decodeAzureName(name: string): string {
  return name.replace(/--([0-9a-f]+)-/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

function isNotFoundError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { statusCode?: number; code?: string };
  return e.statusCode === 404 || e.code === "SecretNotFound";
}
