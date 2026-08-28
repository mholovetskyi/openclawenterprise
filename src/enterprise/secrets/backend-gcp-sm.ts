/**
 * Google Cloud Secret Manager backend.
 *
 * Requires: npm install @google-cloud/secret-manager
 * Auth: Application Default Credentials (ADC) or GOOGLE_APPLICATION_CREDENTIALS env var.
 *
 * Config reference:
 *   enterprise.secrets.backend: gcp-sm
 *   enterprise.secrets.gcpSm:
 *     projectId: my-project          # required
 *     prefix: openclaw/              # optional key prefix filter
 */

import type { OpenClawConfig } from "../../config/config.js";
import type { SecretBackend } from "./index.js";

// ── Minimal structural types for @google-cloud/secret-manager ────────────────
// The package is an optional dependency (zero-dep policy for enterprise
// backends): it is lazy-loaded at runtime, and these local interfaces cover
// only the pieces this backend uses so the file typechecks without it.

type GcpSecretManagerClient = {
  accessSecretVersion(request: {
    name: string;
  }): Promise<[{ payload?: { data?: string | Uint8Array | null } | null }]>;
  createSecret(request: {
    parent: string;
    secretId: string;
    secret: {
      replication: { automatic: Record<string, never> };
      labels?: Record<string, string>;
    };
  }): Promise<unknown>;
  addSecretVersion(request: { parent: string; payload: { data: Uint8Array } }): Promise<unknown>;
  deleteSecret(request: { name: string }): Promise<unknown>;
  listSecretsAsync(request: {
    parent: string;
    filter?: string;
  }): AsyncIterable<{ name?: string | null }>;
  close(): Promise<unknown>;
};

type GcpSecretManagerModule = {
  SecretManagerServiceClient: new () => GcpSecretManagerClient;
};

// Widened to `string` so the compiler does not try to resolve the optional
// package's type declarations at the dynamic import site below.
const GCP_SM_MODULE: string = "@google-cloud/secret-manager";

export async function createGCPSecretManagerBackend(cfg: OpenClawConfig): Promise<SecretBackend> {
  // SAFETY: the OpenClawConfig schema types enterprise.secrets.gcpSm with exactly this shape (projectId plus optional prefix); the cast restates the config contract and its presence is re-validated below before use.
  const gcpCfg = cfg.enterprise?.secrets?.gcpSm as
    | { projectId: string; prefix?: string }
    | undefined;

  if (!gcpCfg?.projectId) {
    throw new Error("enterprise.secrets.gcpSm.projectId is required for gcp-sm backend");
  }

  const projectId = gcpCfg.projectId;
  const prefix = gcpCfg.prefix ?? "";

  // Lazy import — not bundled unless this backend is explicitly enabled.
  // SAFETY: the dynamic import resolves to @google-cloud/secret-manager (the fixed GCP_SM_MODULE specifier); GcpSecretManagerModule mirrors that package's stable SecretManagerServiceClient export, so the resolved-promise shape holds.
  const modulePromise = import(GCP_SM_MODULE) as Promise<GcpSecretManagerModule>;
  const { SecretManagerServiceClient } = await modulePromise.catch(() => {
    throw new Error(
      "Package @google-cloud/secret-manager is not installed.\n" +
        "Run: npm install @google-cloud/secret-manager",
    );
  });

  const client = new SecretManagerServiceClient();
  const parent = `projects/${projectId}`;

  return {
    name: "gcp-sm" as const,

    async exists(key: string): Promise<boolean> {
      const name = `${parent}/secrets/${encodeSecretId(prefix + key)}/versions/latest`;
      try {
        await client.accessSecretVersion({ name });
        return true;
      } catch (err: unknown) {
        if (isNotFoundError(err)) return false;
        throw err;
      }
    },

    async get(key: string): Promise<string | null> {
      const name = `${parent}/secrets/${encodeSecretId(prefix + key)}/versions/latest`;
      try {
        const [version] = await client.accessSecretVersion({ name });
        const payload = version.payload?.data;
        if (!payload) return null;
        return typeof payload === "string" ? payload : Buffer.from(payload).toString("utf8");
      } catch (err: unknown) {
        // Secret not found → return null
        if (isNotFoundError(err)) return null;
        throw err;
      }
    },

    async set(key: string, value: string): Promise<void> {
      const secretId = encodeSecretId(prefix + key);
      const secretName = `${parent}/secrets/${secretId}`;

      // Create secret if it doesn't exist
      try {
        await client.createSecret({
          parent,
          secretId,
          secret: {
            replication: { automatic: {} },
            labels: { "managed-by": "openclaw" },
          },
        });
      } catch (err: unknown) {
        if (!isAlreadyExistsError(err)) throw err;
      }

      // Add a new version with the payload
      await client.addSecretVersion({
        parent: secretName,
        payload: { data: Buffer.from(value, "utf8") },
      });
    },

    async delete(key: string): Promise<void> {
      const secretName = `${parent}/secrets/${encodeSecretId(prefix + key)}`;
      try {
        await client.deleteSecret({ name: secretName });
      } catch (err: unknown) {
        if (isNotFoundError(err)) return;
        throw err;
      }
    },

    async list(keyPrefix?: string): Promise<string[]> {
      const filter = keyPrefix ? `name:${encodeSecretId(prefix + keyPrefix)}` : undefined;
      const iterable = client.listSecretsAsync({ parent, filter });
      const names: string[] = [];
      for await (const secret of iterable) {
        if (!secret.name) continue;
        // Extract the secret ID from the full resource name
        const id = secret.name.split("/").pop() ?? "";
        const decoded = decodeSecretId(id);
        // Strip the backend prefix
        const stripped = prefix ? decoded.replace(prefix, "") : decoded;
        names.push(stripped);
      }
      return names;
    },

    async shutdown(): Promise<void> {
      await client.close();
    },
  };
}

// GCP secret IDs allow [a-zA-Z0-9_-] — encode slashes and dots
function encodeSecretId(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, (c) => `_x${c.codePointAt(0)!.toString(16)}_`);
}

function decodeSecretId(id: string): string {
  return id.replace(/_x([0-9a-f]+)_/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

function isNotFoundError(err: unknown): boolean {
  return (
    // SAFETY: `"code" in err` on this line confirms the property exists; the gRPC status code the Google client attaches is a number (5 = NOT_FOUND).
    typeof err === "object" && err !== null && "code" in err && (err as { code: number }).code === 5
  );
}

function isAlreadyExistsError(err: unknown): boolean {
  return (
    // SAFETY: `"code" in err` on this line confirms the property exists; the gRPC status code the Google client attaches is a number (6 = ALREADY_EXISTS).
    typeof err === "object" && err !== null && "code" in err && (err as { code: number }).code === 6
  );
}
