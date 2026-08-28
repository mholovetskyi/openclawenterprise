# Oracle Cloud Infrastructure Integration

OpenClaw Enterprise integrates with Oracle Cloud Infrastructure (OCI) to provide secret management via OCI Vault, audit log streaming via OCI Streaming, database connectivity via the Oracle Autonomous Database MCP bridge, and portable agent configuration export via Agent Spec JSON.

## Overview

The Oracle Cloud integration provides four independent capabilities:

1. **OCI Vault secret backend** — Store and retrieve secrets using Oracle Cloud Vault (KMS)
2. **OCI Streaming audit sink** — Stream audit events to OCI Streaming in real time
3. **Oracle MCP bridge** — Connect agents to Oracle Autonomous Database via MCP protocol
4. **Agent Spec export** — Export agent configurations as Oracle-compatible Agent Spec JSON

All four are independent and optional — use any combination that fits your deployment.

---

## OCI Vault Secret Backend

Use Oracle Cloud Vault as your secret storage backend. Secrets are encrypted at rest using OCI Key Management and accessed via the OCI Vaults and Secrets APIs.

### Prerequisites

- Oracle Cloud account with OCI Vault service enabled
- A vault and master encryption key created in your compartment
- OCI API key authentication configured (tenancy ID, user ID, fingerprint, private key)
- `oci-sdk` npm package installed

```bash
npm install oci-sdk
```

### Configuration

```yaml
enterprise:
  secrets:
    backend: oci-vault
    ociVault:
      tenancyId: env://OCI_TENANCY_ID
      userId: env://OCI_USER_ID
      fingerprint: env://OCI_FINGERPRINT
      privateKey: env://OCI_PRIVATE_KEY
      region: us-ashburn-1
      compartmentId: env://OCI_COMPARTMENT_ID
      vaultId: env://OCI_VAULT_ID
      keyId: env://OCI_KEY_ID
      prefix: openclaw/ # Optional namespace prefix
```

### Secret URI Scheme

Reference OCI Vault secrets anywhere in configuration using the `oci-vault://` scheme:

```yaml
# By secret name (uses configured prefix)
apiKey: oci-vault://my-api-key

# By OCID (direct reference, no prefix)
apiKey: oci-vault://ocid1.vaultsecret.oc1.iad.xxx
```

### How It Works

- **Get**: Lists secrets by name, retrieves the latest bundle, base64-decodes content
- **Set**: Creates a new secret; falls back to update on conflict (HTTP 409)
- **Delete**: Looks up the secret by name, then schedules deletion via OCI API
- **List**: Paginates through all ACTIVE secrets with `opcNextPage`, filters by prefix

### Error Handling

| OCI Status | Mapped Error                            |
| ---------- | --------------------------------------- |
| 404        | `SecretNotFoundError`                   |
| 401, 403   | Permission error (`SecretBackendError`) |
| 429        | Rate limit error (`SecretBackendError`) |
| Other      | Generic `SecretBackendError`            |

---

## OCI Streaming Audit Sink

Stream OpenClaw Enterprise audit events to Oracle Cloud Streaming in real time. Events are batched, retried on transient failure, and buffered in memory with overflow protection.

### Prerequisites

- Oracle Cloud account with OCI Streaming service enabled
- A stream created in your compartment (must be in ACTIVE state)
- OCI API key authentication configured
- `oci-sdk` npm package installed

```bash
npm install oci-sdk
```

### Configuration

```yaml
enterprise:
  audit:
    enabled: true
    sinks:
      - type: oci-streaming
        streamId: env://OCI_STREAM_ID
        streamEndpoint: env://OCI_STREAMING_ENDPOINT
        tenancyId: env://OCI_TENANCY_ID
        userId: env://OCI_USER_ID
        fingerprint: env://OCI_FINGERPRINT
        privateKey: env://OCI_PRIVATE_KEY
        region: us-ashburn-1
        batchSize: 100 # Events per flush (default 100)
        flushIntervalMs: 5000 # Max wait before flush (default 5000)
        retryAttempts: 3 # Retries on transient failure (default 3)
        retryBackoffMs: 1000 # Initial backoff between retries (default 1000)
        maxBufferSize: 10000 # Max events in memory buffer (default 10000)
```

### Message Format

Each audit event is sent as an OCI Streaming message:

- **Key**: Base64-encoded event ID (ULID)
- **Value**: Base64-encoded JSON of the full audit event, enriched with `tenant_id` from AsyncLocalStorage context

OCI Streaming limits `putMessages` to 5 messages per call. The sink automatically chunks larger batches into groups of 5.

### Startup Validation

On initialization, the sink calls `getStream` to verify the stream exists and is in ACTIVE state. If the stream is in any other lifecycle state (CREATING, DELETING, DELETED, FAILED), the sink disables itself and logs a warning.

### Buffer Overflow

When the in-memory buffer reaches `maxBufferSize`, the oldest event is dropped and a warning is logged. This prevents memory exhaustion — audit delivery is best-effort.

### Metrics

| Metric         | Type      | Labels                            | Description            |
| -------------- | --------- | --------------------------------- | ---------------------- |
| Events total   | Counter   | `outcome` (success/error/dropped) | Total events processed |
| Flush duration | Histogram | `sink`                            | Time per flush batch   |
| Buffer size    | Gauge     | `sink`                            | Current buffer depth   |

---

## Oracle MCP Bridge

Connect OpenClaw Enterprise agents to Oracle Autonomous Database using the MCP (Model Context Protocol) interface. The bridge provides guardrail-protected access to database tools exposed via MCP.

> **Library-only (not config-activated).** `enterprise.oracle` is **not** read by
> `initEnterprise`, so setting `mcp.enabled: true` in config does **not**
> construct the bridge on startup. The bridge is invoked programmatically by
> calling `createOracleMcpBridge(...)` from `src/enterprise/oracle/mcp-bridge.ts`.
> The block below documents the `OracleMcpBridgeConfig` fields you pass to that
> function; the `enabled` field is a config marker only and does not auto-wire the
> bridge.

### Prerequisites

- Oracle Autonomous Database with MCP endpoint enabled
- Network access from OpenClaw Enterprise to the MCP endpoint
- Authentication credentials (OCI API key or bearer token)

### Configuration (fields passed to `createOracleMcpBridge`)

```yaml
# Shape of OracleMcpBridgeConfig — pass these fields programmatically to
# createOracleMcpBridge(); this is NOT auto-activated from config.yaml.
oracleMcpBridge:
  endpoint: env://ORACLE_MCP_ENDPOINT
  auth:
    method: oci-api-key
    tenancyId: env://OCI_TENANCY_ID
    userId: env://OCI_USER_ID
    fingerprint: env://OCI_FINGERPRINT
    privateKey: env://OCI_PRIVATE_KEY
    region: us-ashburn-1
  # Or use bearer token auth:
  # auth:
  #   method: token
  #   bearerToken: env://ORACLE_MCP_TOKEN
  allowedTools:
    - sql_query
    - describe_table
    - list_tables
  blockedTools:
    - drop_table
    - execute_ddl
  requireApproval:
    - create_index
    - alter_table
  maxResultRows: 1000
  queryTimeout: 30000
  healthCheckIntervalMs: 60000
```

### Guardrail Rules

The MCP bridge enforces multiple layers of guardrails before executing any tool call:

#### 1. Tool Blocklist

Tools listed in `blockedTools` are unconditionally blocked. This is checked first.

#### 2. Tool Allowlist

When `allowedTools` is specified, only listed tools are permitted. All unlisted tools are blocked.

#### 3. SQL Injection Detection

All tool inputs are scanned for common SQL injection patterns:

| Pattern                              | Description                        |
| ------------------------------------ | ---------------------------------- |
| `UNION SELECT`                       | Union-based injection              |
| `'; --`                              | Comment-terminated injection       |
| `; DROP/DELETE/TRUNCATE`             | Stacked query injection            |
| `OR '1'='1'`                         | Always-true condition              |
| `UTL_HTTP`, `DBMS_LDAP`, `DBMS_PIPE` | Oracle-specific dangerous packages |

#### 4. Approval Required

Tools listed in `requireApproval` return `require-approval` instead of executing, allowing human review before database modifications.

### Row Limit Enforcement

Results with array content are automatically truncated to `maxResultRows` (default 1000). This prevents agents from accidentally fetching entire tables.

### Health Monitoring

The bridge periodically pings the MCP endpoint at `healthCheckIntervalMs` intervals (default 60 seconds) and exposes health status via Prometheus metrics.

### Metrics

| Metric           | Type      | Labels           | Description            |
| ---------------- | --------- | ---------------- | ---------------------- |
| Tool calls       | Counter   | `tool`, `status` | Total MCP tool calls   |
| Tool latency     | Histogram | `tool`           | Tool call duration     |
| Guardrail blocks | Counter   | `tool`, `rule`   | Blocked tool calls     |
| Health status    | Gauge     | `bridge`         | 0=unhealthy, 1=healthy |

---

## Agent Spec Export

Export OpenClaw Enterprise agent configurations as Agent Spec JSON documents. This enables interoperability with Oracle AI services and provides a portable, vendor-neutral representation of agent capabilities.

> **Library-only (not config-activated).** As with the MCP bridge,
> `enterprise.oracle.agentSpec` is **not** read by `initEnterprise`. The export
> runs only when you call `exportAgentSpec(...)` / `exportAgentSpecToFile(...)`
> from `src/enterprise/oracle/agent-spec-export.ts`. The fields below are the
> export options you pass to those functions, not a startup activation switch.

### Export options (passed to `exportAgentSpecToFile`)

```yaml
# Options for exportAgentSpecToFile(...) — invoked programmatically, not
# auto-run from config.yaml.
agentSpecExport:
  exportPath: ./agent-spec.json
  includeTools: true
  includeSystemPrompt: false # Exclude by default for security
  redactSecrets: true # Redact secret references
```

### Agent Spec Schema

```json
{
  "specVersion": "1.0",
  "metadata": {
    "name": "my-agent",
    "id": "my-agent",
    "version": "1.0.0",
    "createdAt": "2026-03-11T00:00:00.000Z",
    "generator": "openclaw-enterprise"
  },
  "model": {
    "primary": "anthropic/claude-sonnet-4-20250514",
    "fallbacks": ["openai/gpt-4o"]
  },
  "capabilities": ["chat", "tool-use", "code-execution", "sandboxed-execution", "skills"],
  "tools": [
    {
      "name": "coding",
      "profile": "coding",
      "allowed": ["bash", "read"],
      "denied": ["write"]
    }
  ],
  "guardrails": [
    {
      "id": "no-pii",
      "description": "Block PII in output",
      "action": "block"
    }
  ],
  "sandbox": {
    "mode": "all",
    "workspaceAccess": "rw",
    "scope": "session"
  },
  "skills": ["web-search", "code-review"]
}
```

### Secret Redaction

When `redactSecrets: true` (default), the export:

- Replaces secret URI references (`env://`, `vault://`, `oci-vault://`, etc.) with `***REDACTED***`
- Replaces values of keys matching `secret`, `password`, `token`, `key`, `credential` with `***REDACTED***`

### Capabilities Detection

Capabilities are automatically inferred from the agent configuration:

| Capability            | Condition                          |
| --------------------- | ---------------------------------- |
| `chat`                | Always present                     |
| `tool-use`            | Agent has tools configured         |
| `code-execution`      | Tool profile is `coding` or `full` |
| `sandboxed-execution` | Sandbox is configured              |
| `skills`              | Skills list is non-empty           |

---

## Secret Management

Store OCI credentials using any supported secret backend:

```yaml
# Environment variables (simplest)
tenancyId: env://OCI_TENANCY_ID
userId: env://OCI_USER_ID
fingerprint: env://OCI_FINGERPRINT
privateKey: env://OCI_PRIVATE_KEY

# HashiCorp Vault
tenancyId: vault://secret/oracle#tenancy_id
userId: vault://secret/oracle#user_id

# AWS Secrets Manager
tenancyId: aws-sm://oracle/tenancy-id

# GCP Secret Manager
tenancyId: gcp-sm://projects/123/secrets/oci-tenancy-id

# Azure Key Vault
tenancyId: azure-kv://oci-tenancy-id
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                    OpenClaw Enterprise Gateway                        │
│                                                                      │
│  ┌────────────┐  ┌───────────┐  ┌───────────┐  ┌────────────────┐  │
│  │ Agent Runs │  │ Auth/IAM  │  │Guardrails │  │  Channels      │  │
│  └─────┬──────┘  └─────┬─────┘  └─────┬─────┘  └──────┬─────────┘  │
│        │               │              │                │             │
│        └───────────────┬┴──────────────┘                │             │
│                        │                                │             │
│                  ┌─────▼─────┐                          │             │
│                  │AuditLogger│                          │             │
│                  └─────┬─────┘                          │             │
│                        │                                │             │
│              ┌─────────┼────────────┐                   │             │
│              │         │            │                   │             │
│         ┌────▼───┐ ┌───▼───┐  ┌────▼────────┐          │             │
│         │SQLite/ │ │Syslog │  │OCI Streaming│          │             │
│         │Postgres│ │Webhook│  │   Sink      │          │             │
│         │Storage │ │ Sinks │  └──────┬──────┘          │             │
│         └────────┘ └───────┘         │                  │             │
│                                      │                  │             │
│  ┌───────────────┐  ┌───────────────▼─────┐            │             │
│  │  OCI Vault    │  │   OCI Streaming     │            │             │
│  │  (Secrets)    │  │   Service           │            │             │
│  └───────┬───────┘  └────────────────────-┘            │             │
│          │                                              │             │
│  ┌───────▼───────────────────────────────┐              │             │
│  │          Oracle MCP Bridge            │              │             │
│  │  ┌──────────┐  ┌──────────────────┐   │              │             │
│  │  │Guardrails│  │  Row Limit       │   │              │             │
│  │  │  Engine  │  │  Enforcement     │   │              │             │
│  │  └──────────┘  └──────────────────┘   │              │             │
│  └───────┬───────────────────────────────┘              │             │
│          │                                              │             │
└──────────┼──────────────────────────────────────────────┘             │
           │                                                            │
┌──────────▼──────────────────────────────────────────────┐            │
│              Oracle Cloud Infrastructure                 │            │
│                                                          │            │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │            │
│  │  OCI Vault   │  │OCI Streaming │  │ Autonomous DB │  │            │
│  │  (KMS)       │  │  Service     │  │  (MCP)        │  │            │
│  └──────────────┘  └──────────────┘  └───────────────┘  │            │
│                                                          │            │
│  ┌──────────────────────────────────────────────────┐    │            │
│  │           Agent Spec JSON Export                  │    │            │
│  │  (Portable agent configuration document)          │    │            │
│  └──────────────────────────────────────────────────┘    │            │
└──────────────────────────────────────────────────────────┘
```

---

## Troubleshooting

### OCI Vault

**Authentication failures**

- Verify tenancy ID, user ID, fingerprint, and private key are correct
- Ensure the user has permissions on the vault and compartment
- Check that the private key matches the fingerprint uploaded to OCI console

**Secret not found**

- Verify the secret name and prefix match what's in OCI Vault
- Check the secret is in ACTIVE state (not pending deletion)

### OCI Streaming

**Stream not ACTIVE**

- The sink validates stream state on startup and disables itself for non-ACTIVE streams
- Check OCI Console to verify the stream lifecycle state

**Buffer overflow warnings**

- `[oci-streaming] Buffer full` means OCI Streaming is unreachable or slow
- Increase `maxBufferSize` or investigate network connectivity
- Events are dropped to prevent memory exhaustion

**putMessages failures**

- OCI limits to 5 messages per call — the sink handles chunking automatically
- Check for 429 (rate limit) errors and increase `retryBackoffMs`

### Oracle MCP Bridge

**Connection refused**

- Verify the MCP endpoint URL is correct
- Check network access from OpenClaw Enterprise to the Autonomous Database
- For OCI-internal deployments, verify security list / NSG rules

**Guardrail blocks**

- Check `allowedTools` and `blockedTools` configuration
- SQL injection detection may trigger on legitimate queries with complex syntax — review blocked patterns

**Query timeout**

- Increase `queryTimeout` (default 30 seconds)
- Optimize the underlying database query

### Agent Spec Export

**Missing capabilities**

- Capabilities are auto-detected from agent config. Ensure tools, sandbox, and skills are configured.

**Secrets in export**

- Set `redactSecrets: true` (default) to prevent secret leakage
- Review exported files before sharing externally

---

## FAQ

### Do I need Oracle Cloud to use OpenClaw Enterprise?

No. The Oracle integration is fully optional. OpenClaw Enterprise works standalone with any secret backend, any audit sink, and any OIDC provider. The `oci-sdk` package is an optional dependency — it is only loaded when an OCI backend or sink is configured.

### Can I use both OCI Vault and another secret backend?

Not simultaneously. The `enterprise.secrets.backend` setting selects one active backend. However, you can reference secrets from multiple backends using URI schemes — e.g., use `env://` for some values and `oci-vault://` for others.

### Does the MCP bridge support Oracle Database on-premises?

The MCP bridge connects to any MCP-compatible endpoint. If your on-premises Oracle Database exposes an MCP interface, the bridge will work with it. The `auth.method: token` option supports bearer token authentication for non-OCI deployments.

### What happens if OCI Streaming is unreachable?

The audit sink buffers events in memory (default 10,000 events). When the buffer fills, the oldest events are dropped. The gateway continues operating normally — audit delivery is best-effort, and local SQLite/PostgreSQL audit storage is unaffected.

### Can I export Agent Spec without any Oracle Cloud resources?

Yes. The Agent Spec export feature is purely local — it reads your OpenClaw Enterprise agent configuration and writes a JSON file. No Oracle Cloud resources or network access required.
