/**
 * OCI Vault secret backend.
 *
 * Config:
 *   enterprise.secrets.backend: oci-vault
 *   enterprise.secrets.ociVault:
 *     tenancyId: env://OCI_TENANCY_ID
 *     userId: env://OCI_USER_ID
 *     fingerprint: env://OCI_FINGERPRINT
 *     privateKey: env://OCI_PRIVATE_KEY
 *     region: us-ashburn-1
 *     compartmentId: env://OCI_COMPARTMENT_ID
 *     vaultId: env://OCI_VAULT_ID
 *     keyId: env://OCI_KEY_ID
 *     prefix: "openclaw/"
 *
 * Auth: uses OCI API key signing. Falls back to ~/.oci/config when
 * individual fields are not specified (standard OCI SDK behavior).
 *
 * Secret reference URI:
 *   oci-vault://my-secret           -> prefix + "my-secret"
 *   oci-vault://ocid1.vaultsecret.oc1.iad.xxx  -> used as-is (OCID format)
 */

import type { SecretBackend, SecretMetadata } from "./index.js";

export type OciVaultBackendOptions = {
  tenancyId?: string;
  userId?: string;
  fingerprint?: string;
  privateKey?: string;
  region: string;
  compartmentId: string;
  vaultId: string;
  keyId?: string;
  prefix?: string;
};

// ── OCI SDK types (for mocking) ─────────────────────────────────────────────

type OciVaultsClient = {
  createSecret(req: Record<string, unknown>): Promise<{ secret: { id: string } }>;
  updateSecret(req: Record<string, unknown>): Promise<unknown>;
  scheduleSecretDeletion(req: Record<string, unknown>): Promise<unknown>;
  listSecrets(req: Record<string, unknown>): Promise<{
    items: Array<{ secretName: string; id: string; lifecycleState: string }>;
    opcNextPage?: string;
  }>;
  getSecret(req: Record<string, unknown>): Promise<{
    secret: { id: string; secretName: string; lifecycleState: string };
  }>;
};

type OciSecretsClient = {
  getSecretBundle(req: Record<string, unknown>): Promise<{
    secretBundle: { secretBundleContent: { content: string; contentType: string } };
  }>;
};

type OciSdkModules = {
  VaultsClient: new (params: Record<string, unknown>) => OciVaultsClient;
  SecretsClient: new (params: Record<string, unknown>) => OciSecretsClient;
  authProvider: Record<string, unknown>;
};

// ── Deps injection for testing ──────────────────────────────────────────────

export type OciVaultBackendDeps = {
  sdkLoader?: () => Promise<OciSdkModules>;
  vaultsClient?: OciVaultsClient;
  secretsClient?: OciSecretsClient;
};

function isOcid(value: string): boolean {
  return value.startsWith("ocid1.");
}

// Structural shape of the oci-sdk module itself: the client constructors have
// moved between the top level and the vaults/secrets sub-namespaces across
// oci-sdk versions, so all locations are optional and probed below. The
// package is an optional dependency (zero-dep policy for enterprise backends)
// and is lazy-loaded through a widened `string` specifier so the compiler does
// not try to resolve its type declarations.
type OciSdkModuleShape = {
  VaultsClient?: OciSdkModules["VaultsClient"];
  SecretsClient?: OciSdkModules["SecretsClient"];
  vaults?: { VaultsClient?: OciSdkModules["VaultsClient"] };
  secrets?: { SecretsClient?: OciSdkModules["SecretsClient"] };
} & Record<string, unknown>;

const OCI_SDK_MODULE: string = "oci-sdk";

async function loadOciSdk(): Promise<OciSdkModules> {
  let mod: OciSdkModuleShape;
  try {
    // SAFETY: the dynamic import resolves to oci-sdk (the fixed OCI_SDK_MODULE specifier); OciSdkModuleShape marks every client-constructor location optional and VaultsClient/SecretsClient presence is explicitly validated below, so this widened structural view is sound.
    mod = (await import(OCI_SDK_MODULE)) as OciSdkModuleShape;
  } catch {
    throw new Error("OCI Vault secret backend requires oci-sdk. Install with: npm install oci-sdk");
  }
  const VaultsClient = mod.VaultsClient ?? mod.vaults?.VaultsClient;
  const SecretsClient = mod.SecretsClient ?? mod.secrets?.SecretsClient;
  if (!VaultsClient || !SecretsClient) {
    throw new Error(
      "Installed oci-sdk does not expose VaultsClient/SecretsClient — unsupported oci-sdk version",
    );
  }
  return { VaultsClient, SecretsClient, authProvider: mod };
}

export function createOciVaultBackend(
  opts: OciVaultBackendOptions,
  deps?: OciVaultBackendDeps,
): SecretBackend {
  const prefix = opts.prefix ?? "";

  let vaultsClient: OciVaultsClient | null = deps?.vaultsClient ?? null;
  let secretsClient: OciSecretsClient | null = deps?.secretsClient ?? null;

  async function ensureClients(): Promise<{
    vaults: OciVaultsClient;
    secrets: OciSecretsClient;
  }> {
    if (vaultsClient && secretsClient) {
      return { vaults: vaultsClient, secrets: secretsClient };
    }

    const loader = deps?.sdkLoader ?? loadOciSdk;
    const sdk = await loader();

    const authConfig: Record<string, unknown> = {};
    if (opts.tenancyId) {
      authConfig.tenancyId = opts.tenancyId;
    }
    if (opts.userId) {
      authConfig.userId = opts.userId;
    }
    if (opts.fingerprint) {
      authConfig.fingerprint = opts.fingerprint;
    }
    if (opts.privateKey) {
      authConfig.privateKey = opts.privateKey;
    }
    if (opts.region) {
      authConfig.region = opts.region;
    }

    vaultsClient = new sdk.VaultsClient(authConfig);
    secretsClient = new sdk.SecretsClient(authConfig);
    return { vaults: vaultsClient, secrets: secretsClient };
  }

  function secretName(ref: string): string {
    if (isOcid(ref)) {
      return ref;
    }
    return `${prefix}${ref}`;
  }

  function stripPrefix(name: string): string {
    return prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name;
  }

  function mapError(err: unknown): Error {
    // SAFETY: reading three optional properties off an unknown thrown value; every field is optional, so the cast asserts nothing beyond those optional reads (each yields its value or undefined).
    const e = err as { statusCode?: number; serviceCode?: string; message?: string };
    const status = e.statusCode;
    const code = e.serviceCode;
    const message = e.message ?? String(err);

    if (status === 404 || code === "SecretNotFound" || code === "NotAuthorizedOrNotFound") {
      return Object.assign(new Error(`Secret not found: ${message}`), {
        name: "SecretNotFoundError",
        statusCode: 404,
      });
    }
    if (status === 401 || status === 403) {
      return Object.assign(
        new Error(
          `OCI permission denied: ${message}. Check IAM policies for the OCI user/service.`,
        ),
        { name: "SecretBackendError", statusCode: status },
      );
    }
    return Object.assign(new Error(`OCI Vault error (${code ?? status}): ${message}`), {
      name: "SecretBackendError",
      statusCode: status,
    });
  }

  return {
    name: "oci-vault",

    async get(ref: string): Promise<string | null> {
      const { vaults, secrets } = await ensureClients();
      const name = secretName(ref);

      try {
        // If it's an OCID, get the secret bundle directly
        let secretId: string;
        if (isOcid(name)) {
          secretId = name;
        } else {
          // Look up secret by name in the compartment
          const listResp = await vaults.listSecrets({
            compartmentId: opts.compartmentId,
            vaultId: opts.vaultId,
            name,
          });
          const found = listResp.items.find(
            (s) => s.secretName === name && s.lifecycleState === "ACTIVE",
          );
          if (!found) {
            return null;
          }
          secretId = found.id;
        }

        const bundleResp = await secrets.getSecretBundle({ secretId });
        const content = bundleResp.secretBundle.secretBundleContent.content;
        // OCI Vault returns base64-encoded content
        return Buffer.from(content, "base64").toString("utf8");
      } catch (err: unknown) {
        // SAFETY: optional read of `statusCode` off an unknown thrown value.
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404) {
          return null;
        }
        throw mapError(err);
      }
    },

    async set(ref: string, value: string, meta?: SecretMetadata): Promise<void> {
      const { vaults } = await ensureClients();
      const name = secretName(ref);

      try {
        // Try to create a new secret
        await vaults.createSecret({
          createSecretDetails: {
            compartmentId: opts.compartmentId,
            vaultId: opts.vaultId,
            keyId: opts.keyId,
            secretName: name,
            secretContent: {
              contentType: "BASE64",
              content: Buffer.from(value, "utf8").toString("base64"),
            },
            description: meta?.description,
          },
        });
      } catch (err: unknown) {
        // SAFETY: optional read of `statusCode` off an unknown thrown value.
        const status = (err as { statusCode?: number }).statusCode;
        // SAFETY: optional read of `serviceCode` off an unknown thrown value.
        const code = (err as { serviceCode?: string }).serviceCode;

        // Secret already exists — update with a new version
        if (status === 409 || code === "SecretAlreadyExists") {
          // Find the secret ID
          const listResp = await vaults.listSecrets({
            compartmentId: opts.compartmentId,
            vaultId: opts.vaultId,
            name,
          });
          const found = listResp.items.find((s) => s.secretName === name);
          if (!found) {
            throw mapError(err);
          }

          await vaults.updateSecret({
            secretId: found.id,
            updateSecretDetails: {
              secretContent: {
                contentType: "BASE64",
                content: Buffer.from(value, "utf8").toString("base64"),
              },
            },
          });
          return;
        }
        throw mapError(err);
      }
    },

    async delete(ref: string): Promise<void> {
      const { vaults } = await ensureClients();
      const name = secretName(ref);

      try {
        // Find the secret ID
        const listResp = await vaults.listSecrets({
          compartmentId: opts.compartmentId,
          vaultId: opts.vaultId,
          name,
        });
        const found = listResp.items.find((s) => s.secretName === name);
        if (!found) {
          return;
        }

        await vaults.scheduleSecretDeletion({
          secretId: found.id,
          scheduleSecretDeletionDetails: {},
        });
      } catch (err: unknown) {
        // SAFETY: optional read of `statusCode` off an unknown thrown value.
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404) {
          return;
        }
        throw mapError(err);
      }
    },

    async list(): Promise<string[]> {
      const { vaults } = await ensureClients();
      const names: string[] = [];
      let page: string | undefined;

      do {
        const resp = await vaults.listSecrets({
          compartmentId: opts.compartmentId,
          vaultId: opts.vaultId,
          ...(page ? { page } : {}),
        });
        for (const s of resp.items) {
          if (s.lifecycleState !== "ACTIVE") {
            continue;
          }
          const name = s.secretName;
          if (prefix && !name.startsWith(prefix)) {
            continue;
          }
          names.push(stripPrefix(name));
        }
        page = resp.opcNextPage;
      } while (page);

      return names;
    },

    async exists(ref: string): Promise<boolean> {
      const val = await this.get(ref);
      return val !== null;
    },

    async shutdown(): Promise<void> {
      vaultsClient = null;
      secretsClient = null;
    },
  };
}
