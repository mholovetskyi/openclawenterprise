# Palantir Foundry Integration

OpenClaw Enterprise integrates with Palantir Foundry to provide unified audit visibility, seamless SSO authentication, and a deployment path into Foundry's Compute Module infrastructure.

## Overview

The Palantir Foundry integration is designed for organizations that run both OpenClaw Enterprise and Palantir Foundry. It provides three integration points:

1. **Audit log streaming** — Real-time streaming of audit events into a Foundry streaming dataset
2. **OIDC / SSO** — Single sign-on using Palantir as the identity provider
3. **Compute Module deployment** — Run OpenClaw Enterprise directly inside Foundry as a container

All three are independent and optional — use any combination that fits your deployment.

For more information about Palantir Foundry, see [palantir.com](https://www.palantir.com/).

---

## Audit Log Streaming

Stream OpenClaw Enterprise audit events into a Palantir Foundry streaming dataset in real time. CISOs see agent runs, guardrail blocks, auth events, and injection detections in the same platform where they monitor everything else.

### Prerequisites

- Palantir Foundry enrollment with AIP enabled
- A **Developer Console application** with a confidential client (server-to-server OAuth)
- A **streaming dataset** created in Foundry to receive audit events
- `@osdk/client`, `@osdk/oauth`, and `@osdk/foundry.streams` npm packages installed

```bash
npm install @osdk/client @osdk/oauth @osdk/foundry.streams
```

### Step-by-Step Setup

#### 1. Create a Developer Console application

1. In Foundry, navigate to **Developer Console**
2. Click **Create application**
3. Select **Server application (confidential client)**
4. Note the **Client ID**
5. Generate a **Client secret** and store it securely

#### 2. Create a streaming dataset

1. Navigate to **Datasets** in Foundry
2. Click **Create dataset** → **Streaming**
3. Note the **Dataset RID** (format: `ri.foundry.main.dataset.xxx`)
4. Grant the Developer Console app write permissions on this dataset

#### 3. Configure the audit sink

```yaml
enterprise:
  audit:
    enabled: true
    sinks:
      - type: palantir-foundry
        stackUrl: env://PALANTIR_STACK_URL # e.g. https://myorg.palantirfoundry.com
        clientId: env://PALANTIR_CLIENT_ID
        clientSecret: env://PALANTIR_CLIENT_SECRET
        ontologyRid: env://PALANTIR_ONTOLOGY_RID
        streamRid: "ri.foundry.main.dataset.abc123"
        batchSize: 50 # Events per write (default 50)
        flushIntervalMs: 5000 # Max wait before flush (default 5000)
        retryAttempts: 3 # Retries on transient failure
        retryBackoffMs: 1000 # Initial backoff between retries
```

### Streaming Dataset Schema

Each audit event maps to a row in the streaming dataset:

| Column          | Type              | Description                                                                |
| --------------- | ----------------- | -------------------------------------------------------------------------- |
| `event_id`      | string            | ULID sortable event ID                                                     |
| `timestamp`     | timestamp         | ISO 8601 event timestamp                                                   |
| `category`      | string            | Event category (auth, agent, skill, config, admin, data, system, security) |
| `action`        | string            | Event action (e.g. agent.run.start, auth.login.success)                    |
| `actor_id`      | string            | Actor identifier                                                           |
| `actor_type`    | string            | Actor type: user, agent, system, api-key, anonymous                        |
| `resource_type` | string            | Target resource type (e.g. session, agent, skill)                          |
| `resource_id`   | string            | Target resource ID                                                         |
| `outcome`       | string            | Event outcome: success, failure, denied                                    |
| `tenant_id`     | string (nullable) | Tenant ID (when multi-tenancy is enabled)                                  |
| `duration_ms`   | number (nullable) | Operation duration in milliseconds                                         |
| `metadata`      | string            | JSON-serialized additional metadata                                        |
| `prev_hash`     | string            | SHA-256 hash chain reference for tamper evidence                           |

### Secret Management

Store Palantir credentials using any supported secret backend:

```yaml
# HashiCorp Vault
stackUrl: vault://secret/palantir#stack_url
clientId: vault://secret/palantir#client_id
clientSecret: vault://secret/palantir#client_secret

# AWS Secrets Manager
stackUrl: aws-sm://palantir/stack-url
clientId: aws-sm://palantir/client-id
clientSecret: aws-sm://palantir/client-secret

# GCP Secret Manager
stackUrl: gcp-sm://projects/123/secrets/palantir-stack-url
clientId: gcp-sm://projects/123/secrets/palantir-client-id
clientSecret: gcp-sm://projects/123/secrets/palantir-client-secret

# Azure Key Vault
stackUrl: azure-kv://palantir-stack-url
clientId: azure-kv://palantir-client-id
clientSecret: azure-kv://palantir-client-secret

# Environment variables (simplest)
stackUrl: env://PALANTIR_STACK_URL
clientId: env://PALANTIR_CLIENT_ID
clientSecret: env://PALANTIR_CLIENT_SECRET
```

### Troubleshooting

**Authentication failures**

- Verify the client ID and secret are correct in Developer Console
- Ensure the application is a confidential client (not a public client)
- Check that the client secret has not expired

**Network policy issues**

- If running inside Foundry Compute Module, configure Data Connection sources
- If running outside Foundry, ensure your network allows HTTPS to the Foundry stack URL

**Dataset permission errors**

- The Developer Console app needs write permissions on the streaming dataset
- Grant the app's service user the "Editor" role on the dataset

**Buffer overflow warnings**

- `[palantir-sink] Buffer full` means Foundry is unreachable or slow
- Increase `maxBufferSize` or investigate network connectivity
- Events are dropped (not queued indefinitely) to prevent memory exhaustion

---

## OIDC / SSO with Palantir

Use Palantir Foundry as your OIDC identity provider for single sign-on.

### Prerequisites

- Palantir Foundry enrollment
- A Developer Console application with OAuth configured
- Redirect URI registered in the application

### Configuration

Use the `palantir` provider preset instead of manually constructing the discovery URL:

```yaml
enterprise:
  auth:
    oidc:
      provider: palantir
      stackUrl: env://PALANTIR_STACK_URL
      clientId: env://PALANTIR_OIDC_CLIENT_ID
      clientSecret: env://PALANTIR_OIDC_CLIENT_SECRET
      redirectUri: https://openclaw.example.com/auth/oidc/callback
      scopes: [openid, email, profile, offline_access]
      groupsClaim: groups
      roleMap:
        Foundry-Admins: admin
        Foundry-Operators: operator
        Foundry-Viewers: viewer
      defaultRole: viewer
```

The `provider: palantir` preset auto-constructs the discovery URL as `${stackUrl}/.well-known/openid-configuration`. If you need to override this, set `discoveryUrl` explicitly — it takes precedence over the preset.

### Role Mapping

Map Palantir Foundry groups to OpenClaw Enterprise RBAC roles:

```yaml
roleMap:
  # Palantir group name → OpenClaw role
  Platform-Admins: super-admin
  Foundry-Admins: admin
  ML-Engineers: operator
  Data-Analysts: viewer
  External-Contractors: viewer
```

Users not matched by any group mapping get the `defaultRole` (default: `viewer`).

### MFA

Palantir handles MFA at the IdP level. If your Foundry enrollment enforces MFA, users will complete MFA during the Palantir login flow before being redirected back to OpenClaw Enterprise. OpenClaw Enterprise's built-in TOTP MFA (`enterprise.auth.mfa`) is an additional layer that can be enabled on top of Palantir's MFA for defense-in-depth.

### Other OIDC Provider Presets

The same preset mechanism works for other identity providers:

```yaml
# Okta
provider: okta
stackUrl: https://mycompany.okta.com

# Azure AD / Entra ID
provider: azure-ad
tenantId: "abc-123-def-456"

# Google Workspace
provider: google

# Auth0
provider: auth0
stackUrl: https://myapp.us.auth0.com

# Keycloak
provider: keycloak
stackUrl: https://keycloak.internal
realm: openclaw
```

---

## Deploying as a Foundry Compute Module

Run OpenClaw Enterprise directly inside Foundry as a containerized Compute Module.

See the dedicated guide: [Palantir Compute Module deployment](palantir-compute-module.md)

---

## Ontology-Aware Guardrails

OpenClaw Enterprise's pluggable guardrail engine can be extended with custom rules that check agent actions against Palantir Foundry's Ontology state via the OSDK. This is a pattern guide — ontology schemas are customer-specific, so there is no built-in guardrail for this.

### Architecture

```
Agent → Tool Call → Guardrail Engine → Custom OSDK Rule → Ontology Query → Allow/Block
```

The guardrail hook runs before every tool execution. A custom rule can use `@osdk/client` to query the Ontology and block actions that violate business logic.

### Example: Email Recipient Validation

Block the agent from sending emails to recipients not found in the Ontology's `Employee` object type:

```typescript
import type { GuardrailRule } from "../security/guardrails.js";
// Import your generated OSDK package (ontology-specific types)
// import { Employee } from "@your-org/ontology-sdk";

const emailRecipientRule: GuardrailRule = {
  id: "ontology-email-recipient-check",
  description: "Verify email recipients exist in Foundry Ontology",
  scope: "tool-input",
  async evaluate(context) {
    if (context.toolName !== "email.send") return { action: "allow" };

    const recipient = context.input?.to as string | undefined;
    if (!recipient) return { action: "allow" };

    // Query the Ontology for the recipient
    // const employees = await client
    //   .ontology()
    //   .objects(Employee)
    //   .where({ email: { eq: recipient } })
    //   .fetchPage();

    // if (employees.data.length === 0) {
    //   return {
    //     action: "block",
    //     reason: `Recipient ${recipient} not found in organization directory`,
    //   };
    // }

    return { action: "allow" };
  },
};
```

This requires:

1. Your organization's generated OSDK package (created via Foundry's Developer Console)
2. A configured `@osdk/client` instance with access to the relevant Ontology objects
3. The guardrail rule registered in the OpenClaw Enterprise guardrail engine config

### Notes

- The OSDK package is generated from your Ontology schema and is customer-specific
- Network access to the Foundry stack is required from the OpenClaw Enterprise process
- Consider caching Ontology query results to avoid latency on every tool call
- Guardrail rules run synchronously in the tool execution pipeline — keep queries fast

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    OpenClaw Enterprise Gateway                    │
│                                                                  │
│  ┌────────────┐  ┌───────────┐  ┌───────────┐  ┌────────────┐  │
│  │ Agent Runs │  │ Auth/IAM  │  │Guardrails │  │  Channels  │  │
│  └─────┬──────┘  └─────┬─────┘  └─────┬─────┘  └─────┬──────┘  │
│        │               │              │               │          │
│        └───────────────┬┴──────────────┘               │          │
│                        │                               │          │
│                  ┌─────▼─────┐                         │          │
│                  │AuditLogger│                         │          │
│                  └─────┬─────┘                         │          │
│                        │                               │          │
│              ┌─────────┼─────────┐                     │          │
│              │         │         │                     │          │
│         ┌────▼───┐ ┌───▼───┐ ┌──▼──────┐              │          │
│         │SQLite/ │ │Syslog │ │Palantir │              │          │
│         │Postgres│ │Webhook│ │Foundry  │              │          │
│         │Storage │ │ Sinks │ │  Sink   │              │          │
│         └────────┘ └───────┘ └────┬────┘              │          │
│                                   │                    │          │
└───────────────────────────────────┼────────────────────┘          │
                                    │                               │
                    ┌───────────────▼───────────────────┐           │
                    │      Palantir Foundry Stack       │           │
                    │                                   │           │
                    │  ┌──────────────────────────────┐ │           │
                    │  │   Streaming Dataset (Audit)  │ │           │
                    │  └──────────┬───────────────────┘ │           │
                    │             │                     │           │
                    │  ┌──────────▼───────────────────┐ │           │
                    │  │       Ontology Layer         │ │           │
                    │  │  (Agent runs, guardrail      │ │           │
                    │  │   blocks, auth events)       │ │           │
                    │  └─────────────────────────────-┘ │           │
                    │                                   │           │
                    │  ┌─────────────────────────────┐  │           │
                    │  │     OIDC / IdP Service      │──┼───── SSO ─┘
                    │  └─────────────────────────────┘  │
                    │                                   │
                    │  ┌─────────────────────────────┐  │
                    │  │ Compute Module (container)  │  │
                    │  │ ┌─────────────────────────┐ │  │
                    │  │ │ OpenClaw Enterprise     │ │  │
                    │  │ │ Gateway (port 3284)     │ │  │
                    │  │ └─────────────────────────┘ │  │
                    │  └─────────────────────────────┘  │
                    └───────────────────────────────────┘
```

---

## FAQ

### Do I need Palantir Foundry to use OpenClaw Enterprise?

No. The Palantir integration is fully optional. OpenClaw Enterprise works standalone with any OIDC provider, any secret backend, and syslog/webhook audit sinks. The `@osdk/*` packages are optional peer dependencies — they are only loaded when a Palantir audit sink is configured.

### Can I use Palantir AIP (AI FDE) and OpenClaw Enterprise together?

Yes. AIP / AI FDE operates inside Foundry and manages Foundry-native AI workflows. OpenClaw Enterprise operates outside Foundry (or inside a Compute Module) and manages multi-channel AI agents. Audit events from both systems can appear in the same Foundry datasets, giving security teams a unified view.

### Which Compute Module execution mode should I use?

**Functions with Application permissions** is recommended for most use cases. This mode runs the container with the permissions of the Developer Console application's service user, which gives you fine-grained control over what Foundry resources the container can access.

### Does this work with Palantir Government / FedRAMP?

The integration uses standard OSDK APIs (`@osdk/client`, `@osdk/oauth`, `@osdk/foundry.streams`) which are available in all Palantir deployments including government clouds. Network access configuration differs in FedRAMP environments — consult your Palantir administrator for approved endpoints and proxy settings.

### What happens if Foundry is unreachable?

The Palantir audit sink buffers events in memory (default 10,000 events). When the buffer fills, the oldest events are dropped to prevent memory exhaustion. A warning is logged for each dropped event. The gateway continues operating normally — audit delivery is best-effort, and the local SQLite/PostgreSQL audit storage is unaffected.

### Can I use the Palantir OIDC preset with an on-premise Foundry deployment?

Yes. Set `stackUrl` to your on-premise Foundry URL. The preset constructs the discovery URL as `${stackUrl}/.well-known/openid-configuration`, which works for any Foundry deployment regardless of hosting model.
