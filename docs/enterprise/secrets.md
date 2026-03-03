# Secret management

OpenClaw enterprise replaces all plaintext credential files with encrypted secret storage.

## Backends

### File (default enterprise backend)

```yaml
enterprise:
  secrets:
    backend: file
    filePath: ~/.openclaw/secrets.enc # optional override
```

Uses AES-256-GCM with a 32-byte master key. The key is stored in:

- macOS: Keychain (`security find-generic-password -s openclaw-master-key`)
- Windows: `~/.openclaw/.master-key` (DPAPI integration roadmap)
- Linux: `~/.openclaw/.master-key` (mode 0600)

For containers, set `OPENCLAW_MASTER_KEY=<base64-32-bytes>` environment variable.

### HashiCorp Vault

```yaml
enterprise:
  secrets:
    backend: vault
    vault:
      address: https://vault.example.com
      authMethod: kubernetes # kubernetes | approle | token
      role: openclaw # for kubernetes auth
      mount: secret # KV v2 mount
      prefix: openclaw/ # key prefix
      namespace: admin # Vault Enterprise namespace (optional)
```

**AppRole auth:**

```yaml
vault:
  appRole:
    roleId: my-role-id
    secretId: env://VAULT_SECRET_ID
```

**Kubernetes auth** (for in-cluster pods):

```yaml
vault:
  authMethod: kubernetes
  k8sAuth:
    role: openclaw
    serviceAccountTokenPath: /var/run/secrets/kubernetes.io/serviceaccount/token
    mountPath: kubernetes
```

### AWS Secrets Manager

```yaml
enterprise:
  secrets:
    backend: aws-sm
    awsSm:
      region: us-east-1 # optional, defaults to AWS_REGION env
      prefix: openclaw/ # key prefix filter
```

Uses the standard AWS SDK credential chain (env vars, EC2 metadata, ECS task role, etc.).

### GCP Secret Manager

```yaml
enterprise:
  secrets:
    backend: gcp-sm
    gcpSm:
      projectId: my-project
      prefix: openclaw-
```

Uses Application Default Credentials. Run `gcloud auth application-default login` for local dev.

```bash
npm install @google-cloud/secret-manager
```

### Azure Key Vault

```yaml
enterprise:
  secrets:
    backend: azure-kv
    azureKv:
      vaultUrl: https://my-vault.vault.azure.net
      prefix: openclaw-
```

Uses `DefaultAzureCredential` (env vars, managed identity, VS Code, CLI).

```bash
npm install @azure/keyvault-secrets @azure/identity
```

## Secret references in config

Any config value can reference a secret instead of containing it inline:

```yaml
# Environment variable (read-only, for containers)
anthropicApiKey: env://ANTHROPIC_API_KEY

# Vault KV v2
anthropicApiKey: vault://secret/openclaw/anthropic#api_key

# AWS Secrets Manager
anthropicApiKey: aws-sm://openclaw/anthropic-key

# GCP Secret Manager
anthropicApiKey: gcp-sm://projects/my-project/secrets/anthropic-key

# Azure Key Vault
anthropicApiKey: azure-kv://anthropic-key

# Encrypted file backend blob
anthropicApiKey: encrypted://base64ciphertext==
```

References are resolved lazily at runtime via `resolveSecretValue(value)`.

## Legacy migration

On first enterprise start with `backend: file`, OpenClaw automatically:

1. Reads `~/.openclaw/credentials` (if it exists)
2. Encrypts each key with AES-256-GCM
3. Stores in `~/.openclaw/secrets.enc`
4. Renames the original to `~/.openclaw/credentials.migrated`

You can safely delete `.migrated` after verifying the migration.
