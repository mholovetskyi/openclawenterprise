/**
 * Enterprise Secret Management
 *
 * Provides a unified interface for secret storage with pluggable backends:
 *   - file     : AES-256-GCM encrypted local file (default)
 *   - vault    : HashiCorp Vault (KV v2)
 *   - aws-sm   : AWS Secrets Manager
 *   - gcp-sm   : GCP Secret Manager
 *   - azure-kv : Azure Key Vault
 *   - env      : Environment variables (read-only, for containers)
 *
 * Secret references in config:
 *   vault://secret/openclaw/openai#api_key
 *   aws-sm://openclaw/openai-key
 *   gcp-sm://projects/123/secrets/openai-key
 *   encrypted://<store-key>   (lookup key into the active file backend, not an inline blob)
 *   env://OPENAI_API_KEY
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";

export type SecretMetadata = {
  description?: string;
  tags?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
};

export interface SecretBackend {
  readonly name: string;
  get(ref: string): Promise<string | null>;
  set(ref: string, value: string, meta?: SecretMetadata): Promise<void>;
  delete(ref: string): Promise<void>;
  list(): Promise<string[]>;
  exists(ref: string): Promise<boolean>;
  shutdown(): Promise<void>;
}

export type SecretsHandle = {
  backend: SecretBackend;
  shutdown: () => Promise<void>;
};

let activeBackend: SecretBackend | null = null;

// ── Reference parsing ─────────────────────────────────────────────────────────

const SCHEME_RE = /^(vault|aws-sm|gcp-sm|azure-kv|oci-vault|encrypted|env):\/\/(.+)$/;

export type ParsedSecretRef = {
  scheme: "vault" | "aws-sm" | "gcp-sm" | "azure-kv" | "oci-vault" | "encrypted" | "env" | "plain";
  path: string;
  field?: string;
};

export function parseSecretRef(value: string): ParsedSecretRef {
  const match = value.match(SCHEME_RE);
  if (!match) {
    return { scheme: "plain", path: value };
  }
  // SAFETY: SCHEME_RE's group 1 is a fixed alternation of exactly the non-"plain" scheme literals, so on a match the captured text is always one of them.
  const scheme = match[1] as ParsedSecretRef["scheme"];
  // The scheme regex requires a non-empty remainder, so group 2 is always
  // present on a match; the fallback satisfies noUncheckedIndexedAccess.
  const rest = match[2] ?? "";
  const hashIdx = rest.lastIndexOf("#");
  if (hashIdx !== -1) {
    return { scheme, path: rest.slice(0, hashIdx), field: rest.slice(hashIdx + 1) };
  }
  return { scheme, path: rest };
}

/**
 * Resolve a config value that may contain a secret reference.
 * Returns the resolved plaintext or the original value if not a reference.
 */
export async function resolveSecretValue(value: string): Promise<string> {
  const ref = parseSecretRef(value);

  if (ref.scheme === "plain") {
    return value;
  }

  if (ref.scheme === "env") {
    const envValue = process.env[ref.path];
    if (!envValue) {
      throw new Error(`Secret reference env://${ref.path}: environment variable not set`);
    }
    return envValue;
  }

  if (ref.scheme === "encrypted") {
    if (!activeBackend || activeBackend.name !== "file") {
      throw new Error("encrypted:// references require the file backend to be active");
    }
    // Fail closed: a missing encrypted secret must surface as a configuration
    // error, not resolve to an empty credential (which would silently disable
    // auth / fail open downstream).
    const raw = await activeBackend.get(ref.path);
    if (raw === null) {
      throw new Error(`Secret not found: ${value}`);
    }
    return raw;
  }

  if (!activeBackend) {
    throw new Error(`Secret backend not initialized (reference: ${value})`);
  }

  const raw = await activeBackend.get(ref.path);
  if (raw === null) {
    throw new Error(`Secret not found: ${value}`);
  }

  // If the backend stores JSON and a field is specified, parse it
  if (ref.field) {
    try {
      // SAFETY: the vault://path#field convention stores the secret as a flat JSON object of string fields; noUncheckedIndexedAccess still types the indexed read as possibly-undefined, which is checked immediately below.
      const parsed = JSON.parse(raw) as Record<string, string>;
      const fieldValue = parsed[ref.field];
      if (fieldValue === undefined) {
        throw new Error(`Field "${ref.field}" not found in secret ${ref.path}`);
      }
      return fieldValue;
    } catch (err) {
      // SAFETY: the only values thrown inside the try are a SyntaxError from JSON.parse and the explicit `new Error('Field "...')` above — both Error instances — so reading `.message` here is sound.
      if ((err as Error).message.startsWith('Field "')) {
        throw err;
      }
      throw new Error(`Secret ${ref.path} is not valid JSON (needed to extract field)`, {
        cause: err,
      });
    }
  }

  return raw;
}

// ── Initialization ─────────────────────────────────────────────────────────────

export async function initSecretsBackend(cfg: OpenClawConfig): Promise<SecretsHandle> {
  const secretsCfg = cfg.enterprise?.secrets;
  const backendType = secretsCfg?.backend ?? "file";

  let backend: SecretBackend;

  switch (backendType) {
    case "vault": {
      const { createVaultBackend } = await import("./backend-vault.js");
      const vaultCfg = secretsCfg?.vault;
      if (!vaultCfg?.address) {
        throw new Error("enterprise.secrets.vault.address is required for vault backend");
      }
      backend = createVaultBackend({
        address: vaultCfg.address,
        token: vaultCfg.token ?? process.env.VAULT_TOKEN,
        mount: vaultCfg.mount,
        prefix: vaultCfg.prefix,
        authMethod: vaultCfg.authMethod,
        appRole: vaultCfg.appRole,
        // Map the config shape (serviceAccountTokenPath/mountPath) onto the
        // backend's k8s auth options; passing the raw config object left
        // jwtPath undefined so a custom SA token path was silently ignored.
        k8sAuth: vaultCfg.k8sAuth
          ? {
              role: vaultCfg.k8sAuth.role,
              jwtPath: vaultCfg.k8sAuth.serviceAccountTokenPath,
              mountPath: vaultCfg.k8sAuth.mountPath,
            }
          : undefined,
        namespace: vaultCfg.namespace,
      });
      break;
    }

    case "aws-sm": {
      const { createAwsSmBackend } = await import("./backend-aws-sm.js");
      const awsCfg = secretsCfg?.awsSm;
      backend = createAwsSmBackend({
        region: awsCfg?.region ?? process.env.AWS_REGION ?? "us-east-1",
        prefix: awsCfg?.prefix,
      });
      break;
    }

    case "gcp-sm": {
      const { createGCPSecretManagerBackend } = await import("./backend-gcp-sm.js");
      backend = await createGCPSecretManagerBackend(cfg);
      break;
    }

    case "azure-kv": {
      const { createAzureKeyVaultBackend } = await import("./backend-azure-kv.js");
      backend = await createAzureKeyVaultBackend(cfg);
      break;
    }

    case "oci-vault": {
      const { createOciVaultBackend } = await import("./backend-oci-vault.js");
      const ociCfg = secretsCfg?.ociVault;
      if (!ociCfg?.compartmentId || !ociCfg?.vaultId) {
        throw new Error(
          "enterprise.secrets.ociVault.compartmentId and vaultId are required for oci-vault backend",
        );
      }
      backend = createOciVaultBackend({
        tenancyId: ociCfg.tenancyId,
        userId: ociCfg.userId,
        fingerprint: ociCfg.fingerprint,
        privateKey: ociCfg.privateKey,
        region: ociCfg.region ?? "us-ashburn-1",
        compartmentId: ociCfg.compartmentId,
        vaultId: ociCfg.vaultId,
        keyId: ociCfg.keyId,
        prefix: ociCfg.prefix,
      });
      break;
    }

    case "env": {
      // Read-only container mode: resolve from process.env, never mint or
      // persist a master key / on-disk store.
      const { createEnvBackend } = await import("./backend-env.js");
      backend = createEnvBackend();
      break;
    }

    case "none": {
      // The caller (initEnterprise) already skips secret init when backend is
      // "none"; this defensive case ensures a direct initSecretsBackend call
      // never silently falls through to the file backend and writes key
      // material the operator did not request.
      throw new Error(
        'enterprise.secrets.backend is "none": no secret backend configured. ' +
          "Remove the secrets config or choose a real backend to enable secret storage.",
      );
    }

    case "file":
    default: {
      const { createFileBackend } = await import("./backend-file.js");
      const key = await resolveFileBackendKey(cfg);
      const storePath = secretsCfg?.filePath ?? path.join(os.homedir(), ".openclaw", "secrets.enc");
      backend = createFileBackend({ storePath, key });
      await migrateLegacyCredentials(backend, cfg);
      break;
    }
  }

  activeBackend = backend;

  return {
    backend,
    shutdown: async () => {
      await backend.shutdown();
      activeBackend = null;
    },
  };
}

export function getSecretsBackend(): SecretBackend | null {
  return activeBackend;
}

// ── Master key resolution ─────────────────────────────────────────────────────

async function resolveFileBackendKey(_cfg: OpenClawConfig): Promise<Buffer> {
  // 1. Try OS keychain (macOS Keychain, Windows DPAPI, Linux libsecret)
  const keychainKey = await readFromKeychain();
  if (keychainKey) {
    return keychainKey;
  }

  // 2. Try env var OPENCLAW_MASTER_KEY (base64)
  const envKey = process.env.OPENCLAW_MASTER_KEY;
  if (envKey) {
    const buf = Buffer.from(envKey, "base64");
    if (buf.length !== 32) {
      // Fail closed: a present-but-malformed key must not be silently ignored
      // in favor of a freshly minted one — that would render an existing
      // secrets.enc undecryptable and protect new secrets with a key the
      // operator never intended and cannot back up.
      throw new Error(
        `OPENCLAW_MASTER_KEY must be a base64-encoded 32-byte key ` +
          `(decoded to ${buf.length} bytes)`,
      );
    }
    return buf;
  }

  // 3. Generate a new key and store in keychain (first run, only when unset)
  const newKey = randomBytes(32);
  await writeToKeychain(newKey);
  return newKey;
}

async function readFromKeychain(): Promise<Buffer | null> {
  if (process.platform === "darwin") {
    try {
      const { execFileSync } = await import("node:child_process");
      const raw = execFileSync(
        "security",
        ["find-generic-password", "-s", "openclaw-master-key", "-w"],
        { encoding: "utf8", timeout: 5000 },
      ).trim();
      const buf = Buffer.from(raw, "base64");
      if (buf.length === 32) {
        return buf;
      }
    } catch {
      return null;
    }
  }
  return null;
}

async function writeToKeychain(key: Buffer): Promise<void> {
  if (process.platform === "darwin") {
    try {
      const { execFileSync } = await import("node:child_process");
      execFileSync(
        "security",
        [
          "add-generic-password",
          "-U",
          "-s",
          "openclaw-master-key",
          "-a",
          "openclaw",
          "-w",
          key.toString("base64"),
        ],
        { encoding: "utf8", timeout: 5000 },
      );
    } catch {
      // Best-effort — fall back to a local key file
      const keyPath = path.join(os.homedir(), ".openclaw", ".master-key");
      fs.writeFileSync(keyPath, key.toString("base64"), { mode: 0o600 });
    }
  } else {
    // Linux / Windows: write to ~/.openclaw/.master-key with 0o600
    const keyPath = path.join(os.homedir(), ".openclaw", ".master-key");
    const dir = path.dirname(keyPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(keyPath, key.toString("base64"), { mode: 0o600 });
  }
}

// ── Legacy credential migration ───────────────────────────────────────────────

async function migrateLegacyCredentials(
  backend: SecretBackend,
  _cfg: OpenClawConfig,
): Promise<void> {
  const legacyPaths = [
    path.join(os.homedir(), ".openclaw", "credentials"),
    path.join(os.homedir(), ".openclaw", "credentials.json"),
  ];

  for (const legacyPath of legacyPaths) {
    if (!fs.existsSync(legacyPath)) {
      continue;
    }
    try {
      const raw = fs.readFileSync(legacyPath, "utf8");
      // SAFETY: legacy credentials files are JSON objects; values are typed unknown (no shape asserted) and each is re-checked with `typeof value === "string"` below before being migrated.
      const data = JSON.parse(raw) as Record<string, unknown>;
      let migrated = 0;
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === "string") {
          const alreadyMigrated = await backend.exists(`legacy/${key}`);
          if (!alreadyMigrated) {
            await backend.set(`legacy/${key}`, value, {
              description: `Migrated from legacy credentials file`,
              createdAt: new Date().toISOString(),
            });
            migrated++;
          }
        }
      }
      if (migrated > 0) {
        // Rename legacy file instead of deleting (safer)
        fs.renameSync(legacyPath, `${legacyPath}.migrated`);
        process.stderr.write(
          `[openclaw] Migrated ${migrated} credentials from ${legacyPath} to encrypted storage.\n` +
            `[openclaw] Legacy file renamed to ${legacyPath}.migrated — review and delete when ready.\n`,
        );
      }
    } catch {
      // Non-fatal: if migration fails, original file is untouched
    }
  }
}
