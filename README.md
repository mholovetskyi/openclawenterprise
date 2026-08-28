# 🦞 OpenClaw Enterprise

<p align="center">
    <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/openclaw-enterprise-logo.png">
        <source media="(prefers-color-scheme: light)" srcset="docs/assets/openclaw-enterprise-logo.png">
        <img src="docs/assets/openclaw-enterprise-logo.png" alt="OpenClaw Enterprise" width="680">
    </picture>
</p>

<p align="center">
  <strong>The enterprise layer for OpenClaw — zero-trust, compliance-ready, MIT licensed.</strong><br>
  Built on top of the platform you already love. No subscriptions. No lock-in.
</p>

<p align="center">
  <a href="https://github.com/openclaw/openclaw/actions/workflows/ci.yml?branch=main">
    <img src="https://img.shields.io/github/actions/workflow/status/openclaw/openclaw/ci.yml?branch=main&style=for-the-badge" alt="CI">
  </a>
  <a href="https://github.com/openclaw/openclaw/releases">
    <img src="https://img.shields.io/github/v/release/openclaw/openclaw?include_prereleases&style=for-the-badge" alt="Release">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT">
  </a>
  <a href="https://discord.gg/clawd">
    <img src="https://img.shields.io/discord/1456350064065904867?label=Discord&logo=discord&logoColor=white&color=5865F2&style=for-the-badge" alt="Discord">
  </a>
  <a href="https://github.com/openclaw/openclaw/stargazers">
    <img src="https://img.shields.io/github/stars/openclaw/openclaw?style=for-the-badge&color=gold" alt="Stars">
  </a>
</p>

<p align="center">
  <a href="#built-since-gtc">Built since GTC</a> ·
  <a href="#install">Install</a> ·
  <a href="#where-openclaw-stops">Enterprise gap</a> ·
  <a href="#zero-trust-gateway">Security</a> ·
  <a href="#secret-management">Secrets</a> ·
  <a href="#iam--rbac">IAM</a> ·
  <a href="#oidc--sso">OIDC/SSO</a> ·
  <a href="#mfa--totp">MFA</a> ·
  <a href="#audit-logging--compliance">Audit</a> ·
  <a href="#gdpr-compliance-art-17--art-20">GDPR</a> ·
  <a href="#distributed-cluster">Cluster</a> ·
  <a href="#kubernetes">Kubernetes</a> ·
  <a href="#connecting-to-enterprise-messaging">Channels</a> ·
  <a href="#nvidia-ai-infrastructure">NVIDIA</a> ·
  <a href="#test-suite--quality-assurance">Tests</a> ·
  <a href="docs/enterprise/">Docs</a>
</p>

---

**OpenClaw** is one of the most capable open-source AI agent platforms available. With 216,000 GitHub stars, it excels at personal productivity and small-team automation: connecting your AI to WhatsApp, Telegram, Discord, and 14 other channels, running browser automation, managing calendars, and orchestrating complex multi-step tasks from a single self-hosted gateway. For individuals and small teams, it's outstanding.

Enterprise deployments have a different set of requirements. Regulated industries need audit trails, access control, and encrypted credential storage. Platform teams need Prometheus metrics and Kubernetes-native deployment. Security-conscious organizations need runtime guardrails, prompt injection defenses, and supply chain verification for third-party skills. These aren't gaps in OpenClaw's quality — they're simply outside its design scope as a personal-use tool.

**OpenClaw Enterprise** adds the complete enterprise stack on top of the OpenClaw foundation. Every enterprise feature is an opt-in module (`enterprise.enabled: true`). In community mode the binary is identical and there is no performance overhead. 100% MIT-licensed. Zero subscriptions.

---

## Built since GTC

> _The gap between "demo-ready" and "enterprise-ready" is enormous. We closed it._

Since NVIDIA GTC, OpenClaw Enterprise has shipped a production-ready, MIT-licensed enterprise stack — zero subscriptions, zero lock-in. Every feature is opt-in with zero overhead when disabled. Here's what landed:

### NVIDIA-native AI infrastructure

- **NVIDIA NIM** — first-class inference provider with OpenAI-compatible endpoints, health checks, and retry logic
- **NemoClaw Enterprise** — sandboxed inference with OpenShell containers, privacy routing, and 3 deployment profiles (`nvidia-cloud`, `local-nim`, `vllm`)
- **GPU telemetry** — nvidia-smi polling with Prometheus export and configurable alert thresholds
- **Nemotron 3 model family** — Super 120B, Nano 30B, and Super 49B supported out of the box
- **NVIDIA guardrails** — thinking budget limits, per-user/per-tenant cost caps, RBAC-based model routing

### Zero-trust security stack

- **Encrypted secrets** — AES-256-GCM at rest, 6 backends (Vault, AWS SM, GCP SM, Azure KV, OCI Vault, env)
- **Full RBAC** — Users, Groups, Roles, Permissions with JWT (RS256/HS256), MFA/TOTP, API keys
- **OIDC/SSO** — Okta, Azure AD, Google Workspace, Auth0, Keycloak, Palantir Foundry
- **Runtime guardrails** — credential harvest detection, reverse shell blocking, PII scanning, mass-deletion prevention
- **Input sanitization** — Unicode normalization, invisible character stripping, 8 prompt injection pattern families
- **Supply chain security** — Ed25519 code signing, 14-rule SAST scanner (CWE/OWASP), pre-install approval gates
- **Network controls** — IP allowlisting (CIDR, IPv4/IPv6), token-bucket rate limiting

### Compliance and observability

- **Tamper-evident audit** — SHA-256 hash-chain logging, SQLite or PostgreSQL, ULID event IDs
- **External sinks** — Syslog (RFC 5424), webhook batching, Palantir Foundry streaming, OCI Streaming
- **Prometheus** — 20+ metrics, Kubernetes health probes (`/healthz`, `/readyz`, `/startupz`)
- **GDPR** — data export (Art. 20) and erasure (Art. 17), SOC 2 / HIPAA / PCI DSS mapping
- **Container security** — SBOM generation (SPDX), image signing (cosign), vulnerability scanning (Trivy)

### Enterprise integrations

- **Palantir Foundry** — audit streaming, OIDC preset, Compute Module deployment
- **Oracle Cloud** — MCP bridge to Autonomous Database, OCI Vault secrets, OCI Streaming audit, Agent Spec export
- **Multi-tenancy** — AsyncLocalStorage isolation with per-tenant rate limits, quotas, and audit
- **Cluster mode** — Redis-based coordination with heartbeat protocol for multi-gateway deployments

### Platform

- **16 messaging channels** — WhatsApp, Telegram, Discord, Slack, Signal, iMessage, Matrix, and more
- **Embedded Pi agent runtime** — context pruning, auth profile rotation, multi-agent orchestration
- **Integration SDK** — plugin loader, scaffolding CLI, reference integrations
- **396 tests** across 22 test files — every enterprise subsystem covered

All of this — open source, MIT licensed, self-hostable anywhere.

---

## Install

OpenClaw Enterprise is a source-available fork — build it from this repository. Requires Node.js 22.22.3+, 24.15.0+, or 25.9.0+ and [pnpm](https://pnpm.io).

```bash
# 1. Clone the enterprise fork
git clone https://github.com/mholovetskyi/openclawenterprise.git
cd openclawenterprise

# 2. Install dependencies and build
pnpm install
pnpm build
pnpm ui:build

# 3. First-time setup (config, daemon, shell completion)
pnpm openclaw onboard --install-daemon

# 4. Start the gateway
pnpm gateway:watch
```

> **Node.js 22.22.3+, 24.15.0+, or 25.9.0+** is required. Install via [fnm](https://github.com/Schniz/fnm) (`fnm install 24`), [nvm](https://github.com/nvm-sh/nvm), or the [official installer](https://nodejs.org).
>
> Looking for the community edition? `npm install -g openclaw@latest` — no build step needed.

---

## Where OpenClaw stops

OpenClaw is purpose-built for personal and small-team use. It does that job exceptionally well. When organizations try to deploy it in regulated or security-sensitive environments, they consistently hit the same eight gaps — not because OpenClaw is flawed, but because these requirements are simply out of scope for a personal tool.

OpenClaw Enterprise closes each gap without touching the core.

### 1. Network exposure is opt-in, not accidental

OpenClaw's gateway binds to all interfaces (`0.0.0.0`) in LAN mode — the right default for a personal assistant you're sharing on your home network. In a corporate environment, that exposes the gateway to every host on the subnet without any warning.

**Enterprise adds:** Strict loopback-only default. Every non-loopback bind emits a prominent warning with the exact address. The `dangerouslyBindAllInterfaces` flag must be set explicitly. (`src/gateway/net.ts`)

### 2. Credentials need to be encrypted at rest

OpenClaw stores API keys, OAuth tokens, and webhook secrets in `~/.openclaw/credentials` — a plaintext file, which is the right trade-off for a personal tool where simplicity beats vault complexity. On a shared server or a machine that generates bug reports, plaintext secrets are a liability.

**Enterprise adds:** AES-256-GCM encrypted file backend with the master key in the OS keychain. HashiCorp Vault, AWS Secrets Manager, GCP Secret Manager, Azure Key Vault, and OCI Vault are all supported. Existing credentials auto-migrate. (`src/enterprise/secrets/`)

### 3. Not every client should have full operator access

OpenClaw's gateway authenticates with a single shared token — you either have it or you don't. That's fine for personal use. It doesn't work when you have developers, read-only dashboards, and automated service accounts all connecting to the same gateway.

**Enterprise adds:** Full RBAC with 5 built-in roles, wildcard permissions, group inheritance, JWT RS256/HS256, and API key management. (`src/enterprise/iam/`)

### 4. Regulated industries require audit trails

OpenClaw doesn't log who connected, what ran, or what data was accessed — there's no reason it should for personal use. SOC 2 CC6/CC7, HIPAA §164.312(b), and PCI DSS 10 all require this record.

**Enterprise adds:** Tamper-evident SHA-256 hash-chain audit log covering auth events, agent runs, tool executions, guardrail blocks, and injection detections. (`src/enterprise/audit/`)

### 5. Untrusted channel messages need sanitization

OpenClaw sends channel messages directly to the model — exactly the right behavior when you trust the people messaging your personal assistant. When the bot is deployed in a public channel or customer-facing context, any user can attempt prompt injection.

**Enterprise adds:** Multi-stage sanitization pipeline: Unicode normalization, invisible character stripping, injection pattern detection (8 rule families), trust boundary tagging, and configurable truncation. (`src/enterprise/security/input-sanitizer.ts`)

### 6. Tool execution needs a guardrail layer

Skills and the bash tool can run any command with the permissions of the running process. For a personal assistant, that power is the point. For a deployment running in production, you need an interception layer before a confused-deputy attack or a malicious skill does damage.

**Enterprise adds:** Pluggable guardrail engine that evaluates every tool call before execution. Default rules cover credential harvest, reverse shells, mass delete, and PII in outputs. (`src/enterprise/security/guardrails.ts`)

### 7. Platform teams need metrics and health probes

OpenClaw has no `/healthz`, no `/metrics`, and no Prometheus integration. For a personal assistant, you know it's healthy because it's responding. For a Kubernetes deployment behind an ALB, you need probes and dashboards.

**Enterprise adds:** `/metrics` (Prometheus), `/healthz`, `/livez`, `/readyz`, `/startupz` — all pre-registered before other routes. 20+ metrics across the gateway, agent runtime, auth, guardrails, and skills. (`src/enterprise/monitoring/`)

### 8. Enterprise config needs type safety

OpenClaw's config type had no `enterprise` key — enterprise config was silently treated as `unknown`, meaning misconfigured settings would be ignored at runtime with no error.

**Enterprise adds:** 9 fully-typed subsystem config interfaces in `OpenClawConfig`. TypeScript catches misconfigured enterprise settings at compile time. (`src/config/types.enterprise.ts`)

---

## Architecture

```
                          ┌─────────────────────────────────────────────────────┐
                          │                   INBOUND CHANNELS                  │
                          │  WhatsApp · Telegram · Slack · Discord · Teams ·    │
                          │  Signal · iMessage · Matrix · Google Chat · WebChat  │
                          └────────────────────────┬────────────────────────────┘
                                                   │
                          ┌────────────────────────▼────────────────────────────┐
                          │              ENTERPRISE SECURITY LAYER              │
                          │  ① Unicode normalization + invisible char strip      │
                          │  ② Prompt injection pattern detection (8 families)  │
                          │  ③ Trust boundary tagging <EXTERNAL CONTENT>        │
                          │  ④ Configurable message truncation (32 KB default)  │
                          └────────────────────────┬────────────────────────────┘
                                                   │
┌──────────────────────┐  ┌────────────────────────▼────────────────────────────┐  ┌──────────────────────┐
│   ENTERPRISE IAM     │  │                      GATEWAY                        │  │  ENTERPRISE SECRETS  │
│                      │◄─┤  WebSocket control plane · HTTP API · REST compat   ├─►│                      │
│  OIDC/SSO (PKCE)     │  │  bind: loopback (default) — 0.0.0.0 NEVER silent   │  │  AES-256-GCM file    │
│  MFA/TOTP (RFC 6238) │  │  auth: jwt | token | password | none                │  │  HashiCorp Vault     │
│  JWT RS256/HS256     │  │  /metrics  /healthz  /livez  /readyz  /startupz     │  │  AWS Secrets Manager │
│  API keys (oc_...)   │  └────────────────────────┬────────────────────────────┘  │  GCP Secret Manager  │
│  RBAC (5 built-in)   │                           │                               │  Azure Key Vault     │
│  SQLite persistent   │  ┌────────────────────────▼────────────────────────────┐  └──────────────────────┘
│  Token revocation    │                                                            ┌──────────────────────┐
│  IP allowlisting     │                                                            │  SIGNED CONTAINERS   │
└──────────────────────┘                                                            │                      │
                                                                                    │  cosign keyless      │
                                                                                    │  syft SBOM (SPDX)   │
                                                                                    │  Trivy vuln scan     │
                                                                                    └──────────────────────┘
└──────────────────────┘  │                   AGENT RUNTIME                     │
                          │                                                     │
┌──────────────────────┐  │  ┌─────────────┐  ┌──────────────────────────────┐ │  ┌──────────────────────┐
│  TAMPER-EVIDENT      │  │  │  Tool call  │  │   GUARDRAIL ENGINE           │ │  │  PROMETHEUS METRICS  │
│  AUDIT LOG           │  │  │  hook       │◄─┤   ① Credential harvest       │ │  │                      │
│                      │◄─┤  │             │  │   ② Reverse shell patterns   │ │  │  gateway_connections │
│  SHA-256 hash chain  │  │  └─────────────┘  │   ③ Mass delete (rm -rf /)  │ │  │  agent_runs_total    │
│  ULID IDs            │  │                   │   ④ SSN / credit card PII   │ │  │  auth_failures_total │
│  SQLite WAL          │  │  ┌─────────────┐  │   ⑤ Custom pluggable rules  │ │  │  guardrail_blocks    │
│  PostgreSQL backend  │  │  │  Skills     │  └──────────────────────────────┘ │  │  skill_invocations   │
│  SIEM/Syslog (RFC    │  │  │  (Ed25519   │                                   │  │  audit_events_total  │
│   5424) · Webhook    │  │  │   signed)   │  ┌──────────────────────────────┐ │  │  /metrics endpoint   │
│  GDPR export+erase   │  │  │             │  │  ENTERPRISE SAST             │ │  │  Grafana dashboards  │
│  Audit events:       │  │  │  SAST scan  │  │  14 rules · CWE/OWASP tags  │ │  └──────────────────────┘
│  auth.login          │  │  │  before     │  │  Risk score 0–100            │ │
│  guardrail.block     │  │  │  install    │  │  approve / review / reject   │ │  ┌──────────────────────┐
└──────────────────────┘  │  └─────────────┘  └──────────────────────────────┘ │  │  MULTI-TENANCY       │
                          └────────────────────────────────────────────────────┘  │                      │
                                                                                   │  AsyncLocalStorage   │
                          ┌────────────────────────────────────────────────────┐  │  Per-tenant limits   │
                          │  KUBERNETES (Helm chart)                           │  │  Zero-boilerplate    │
                          │  HPA · PDB · NetworkPolicy · ServiceMonitor        │  │  propagation         │
                          │  Rolling updates · Non-root · ReadOnlyRootFS       │  └──────────────────────┘
                          └────────────────────────────────────────────────────┘

                          ┌────────────────────────────────────────────────────┐
                          │  NVIDIA AI INFRASTRUCTURE                          │
                          │                                                    │
                          │  ┌──────────────┐  ┌─────────────────────────────┐ │  ┌──────────────────────┐
                          │  │ NIM Provider  │  │  NIM Container (sidecar)   │ │  │  GPU MONITORING      │
                          │  │              │  │  Nemotron 3 Nano/Super     │ │  │                      │
                          │  │ Hosted NIM   │  │  localhost:8000/v1         │ │  │  nvidia-smi polling  │
                          │  │ or sidecar   │  │  GPU-accelerated inference │ │  │  Prometheus gauges   │
                          │  └──────────────┘  └─────────────────────────────┘ │  │  Threshold alerts    │
                          │                                                    │  └──────────────────────┘
                          │  Guardrails: thinking budget · cost guard · RBAC   │
                          └────────────────────────────────────────────────────┘
```

---

## Zero-trust gateway

The gateway is the heart of OpenClaw. In the original, it would silently bind to `0.0.0.0` in several fallback paths. Enterprise OpenClaw enforces a strict policy:

**Default: loopback only.** The gateway binds to `127.0.0.1` unless you explicitly configure otherwise. No surprise network exposure.

**Explicit warnings.** Any non-loopback bind emits a prominent bordered warning to stderr and the startup log, listing the exact address and port. You cannot miss it.

**`dangerouslyBindAllInterfaces` required.** LAN mode, Tailscale, and custom host configs must be explicitly acknowledged. Silent fallbacks are gone.

**Auth mode warnings.** If `gateway.auth.mode: none` is set alongside a non-loopback bind, an additional warning fires. Running auth-less on the internet is still possible but impossible to do accidentally.

```yaml
gateway:
  bind: loopback # Default — only 127.0.0.1:port is reachable
  # bind: lan           # ⚠ ALL interfaces (0.0.0.0) — explicit warning emitted
  # bind: tailnet       # Tailscale IP only — recommended for remote access
  # bind: custom
  #   host: 10.0.0.5    # Specific IP — warning if non-loopback

  port: 3284

  auth:
    mode:
      jwt # jwt | token | password | none
      # ⚠ 'none' on non-loopback emits security warning
```

**TLS.** TLS termination is expected at the ingress layer (nginx, Caddy, ALB). The Helm chart configures cert-manager + Let's Encrypt by default. WebSocket connections use `wss://` automatically when TLS is active.

---

## Secret management

The original OpenClaw stored every API key, OAuth token, and webhook secret in `~/.openclaw/credentials` — a world-readable plaintext JSON file. Enterprise mode replaces this entirely.

### How it works

Every secret is stored encrypted at rest. The master key lives in your OS keychain, never on disk in plaintext. Secret references in config use URI syntax — the actual value is resolved at runtime:

```yaml
# Instead of: anthropicApiKey: "sk-ant-abc123"
# Use a secret reference:

anthropicApiKey: env://ANTHROPIC_API_KEY # container env var
anthropicApiKey: vault://secret/openclaw/keys#anthropic
anthropicApiKey: aws-sm://openclaw/anthropic-key
anthropicApiKey: gcp-sm://projects/my-proj/secrets/anthropic
anthropicApiKey: azure-kv://anthropic-api-key
```

### Encrypted file backend (default)

For local and single-server deployments. Uses **AES-256-GCM** with a 32-byte random key stored in:

- **macOS**: Keychain (`security find-generic-password -s openclaw-master-key`)
- **Linux**: `~/.openclaw/.master-key` (mode `0600`)
- **Windows**: `~/.openclaw/.master-key` (DPAPI integration roadmap)
- **Containers**: `OPENCLAW_MASTER_KEY=<base64-32-bytes>` environment variable

```yaml
enterprise:
  secrets:
    backend: file
    filePath: ~/.openclaw/secrets.enc # optional override
```

The encryption envelope format: `version(1B) | iv(12B) | auth-tag(16B) | ciphertext(nB)`. The auth tag detects tampering before decryption is attempted.

**Legacy migration.** On first enterprise start, `~/.openclaw/credentials` is automatically read, each key encrypted, stored in the new backend, and the original renamed to `.credentials.migrated`. The migration is non-destructive — the original is never deleted until you confirm.

### HashiCorp Vault

Production-grade secrets management for teams. Supports KV v2, AppRole auth, and Kubernetes auth for in-cluster pods.

```yaml
enterprise:
  secrets:
    backend: vault
    vault:
      address: https://vault.example.com
      authMethod: kubernetes # token | approle | kubernetes
      role: openclaw
      mount: secret # KV v2 mount path
      prefix: openclaw/ # key namespace prefix
      namespace: admin # Vault Enterprise namespace (optional)
```

**AppRole** (for CI/CD pipelines):

```yaml
vault:
  appRole:
    roleId: <role-id>
    secretId: env://VAULT_SECRET_ID # secret never in config file
```

**Kubernetes** (for in-cluster pods — zero credential management):

```yaml
vault:
  authMethod: kubernetes
  k8sAuth:
    role: openclaw
    serviceAccountTokenPath: /var/run/secrets/kubernetes.io/serviceaccount/token
```

### AWS Secrets Manager

Uses the standard AWS SDK credential chain — IAM roles, ECS task roles, EC2 instance profiles, environment variables. No credentials needed in config for EC2/ECS/Lambda deployments.

```yaml
enterprise:
  secrets:
    backend: aws-sm
    awsSm:
      region: us-east-1
      prefix: openclaw/
```

```bash
npm install  # @aws-sdk/client-secrets-manager auto-installed
```

### GCP Secret Manager

Uses Application Default Credentials. On GKE, Workload Identity means zero credential management.

```yaml
enterprise:
  secrets:
    backend: gcp-sm
    gcpSm:
      projectId: my-gcp-project
      prefix: openclaw-
```

```bash
npm install @google-cloud/secret-manager
gcloud auth application-default login  # for local dev
```

### Azure Key Vault

Uses `DefaultAzureCredential` — automatically picks up managed identity, VS Code auth, Azure CLI, or environment variables.

```yaml
enterprise:
  secrets:
    backend: azure-kv
    azureKv:
      vaultUrl: https://my-vault.vault.azure.net
      prefix: openclaw-
```

```bash
npm install @azure/keyvault-secrets @azure/identity
az login  # for local dev
```

---

## IAM / RBAC

The original OpenClaw had a single auth level: you either had the gateway token or you didn't. Every authenticated client had full operator access. Enterprise IAM introduces proper identity and least-privilege access control.

### Identity model

```
User ──── has roles ──► Role ──── has permissions ──► Resource.Action
  │
  └── member of ──────► Group ──── has roles
                                      │
AgentIdentity ─────────────────────── ▼
(service account)                 wildcard support:
                                  "agents.*"  ← all agent perms
                                  "skills.install"  ← exact
                                  "*"  ← super-admin only
```

### Built-in roles

| Role            | Permissions                                           |
| --------------- | ----------------------------------------------------- |
| `super-admin`   | `*` — everything                                      |
| `admin`         | All resources except user/role management             |
| `operator`      | Agents, skills, channels, sessions — no config write  |
| `viewer`        | Read-only on all resources                            |
| `agent-service` | Scoped to agent execution only — for service accounts |

Custom roles can be defined with any combination of permissions. Roles can inherit from other roles. Cycles are detected and rejected.

### JWT authentication

JWT is the recommended auth mode for multi-user and enterprise deployments. On first start with `algorithm: RS256`, OpenClaw **auto-generates an RSA-2048 key pair** and writes it to `~/.openclaw/enterprise/iam/`. You never need to manage keys manually.

```yaml
enterprise:
  iam:
    enabled: true
    jwt:
      algorithm: RS256 # RS256 (default) or HS256
      expiresIn: 15m # access token TTL
      refreshExpiresIn: 7d # refresh token TTL
      issuer: openclaw # JWT iss claim
```

Token lifecycle:

- **Access tokens**: 15 minutes, signed RS256, contain `sub` (user/agent ID), `roles`, `scopes`
- **Refresh tokens**: 7 days, single-use, rotated on each refresh
- **API keys**: `oc_<base64url-random>` format, SHA-256 hash stored (never the raw key), shown once at generation

### Backwards compatibility

Existing `operator.*` scope tokens from the community edition continue to work. They are automatically mapped to the RBAC `operator` role permissions via the `LEGACY_SCOPE_TO_PERMISSIONS` adapter — no migration required.

### OIDC / SSO

OpenClaw Enterprise ships an OpenID Connect (OIDC) module supporting any compliant IdP — Okta, Azure AD / Entra ID, Google Workspace, Auth0, Keycloak, Dex. The flow uses **PKCE** (Proof Key for Code Exchange) with server-side state validation. No external OIDC library required — pure Node.js.

> **Not wired as a login flow in this build.** `initEnterprise` does not call
> `initOidc`, so the endpoints below are **not** registered automatically and
> enabling `enterprise.auth.oidc` does not activate OIDC login (the gateway warns
> at boot). The module (`OidcService` / `createOidcHandlers` / `initOidc` in
> `src/enterprise/auth/oidc.ts`) is available to invoke programmatically until the
> login flow is wired.

```yaml
enterprise:
  auth:
    oidc:
      discoveryUrl: https://your-org.okta.com/.well-known/openid-configuration
      clientId: 0oa...
      clientSecret: env://OIDC_CLIENT_SECRET # never inline
      redirectUri: https://openclaw.example.com/auth/oidc/callback
      scopes: [openid, email, profile, groups]
      groupsClaim: groups # JWT claim that contains IdP groups
      roleMap:
        Engineering: operator # IdP group name → OpenClaw RBAC role ID
        Admins: admin
        SRE: admin
      defaultRole: viewer # role for users not matched by roleMap
```

**Endpoints the module defines (not auto-registered — see note above):**

| Endpoint                  | Description                                                |
| ------------------------- | ---------------------------------------------------------- |
| `GET /auth/oidc/login`    | Redirect to IdP authorization endpoint with PKCE challenge |
| `GET /auth/oidc/callback` | Exchange code, verify ID token, issue OpenClaw JWTs        |

**How it works:**

1. `/auth/oidc/login` — generates a PKCE code verifier + SHA-256 challenge, stores pending state (10-minute TTL), redirects to IdP
2. IdP authenticates and redirects back with `?code=...&state=...`
3. State is validated and consumed; authorization code exchanged for tokens at IdP token endpoint
4. **ID token signature verified against the IdP's JWKS** — RSA public keys fetched from discovery URL, cached 5 minutes, matched by `kid` header
5. Claims checked: `exp`, `nbf`, `iss`, `aud`
6. User's IdP groups mapped to RBAC roles via `roleMap`; user provisioned/updated in SQLite RBAC store
7. OpenClaw access + refresh tokens issued and returned to client

(`src/enterprise/auth/oidc.ts`)

---

### MFA / TOTP

Time-based one-time passwords (TOTP, RFC 6238) with no external dependencies — pure Node.js implementation (HMAC-SHA1, 30-second windows, 6-digit codes, ±1 step clock-skew tolerance).

> **Not enforced at authentication in this build.** `MfaService.verify` is only
> reachable through the admin-gated `enterprise.mfa.*` RPC methods below; no
> login or token-issuance path challenges for a second factor. Because booting
> with MFA "on" but never challenged is worse than off (false assurance), setting
> `enterprise.auth.mfa` (`enabled` or `requireForRoles`) makes the gateway
> **refuse to boot** (fail closed). Leave it unset until MFA is wired into the
> auth/token-issuance path.

```yaml
# Configured, but NOT enforced at auth — enabling this refuses to boot.
enterprise:
  auth:
    mfa:
      enabled: true
      issuer: "My Company OpenClaw" # label shown in authenticator apps
      requireForRoles: [admin, super-admin] # intended enforcement — NOT active yet
```

**Gateway RPC methods:**

| Method                          | Description                                                 |
| ------------------------------- | ----------------------------------------------------------- |
| `enterprise.mfa.enroll`         | Generate TOTP secret + `otpauth://` URI for QR code display |
| `enterprise.mfa.confirm-enroll` | Confirm enrollment with first valid code                    |
| `enterprise.mfa.verify`         | Verify a code (login step-up)                               |
| `enterprise.mfa.disable`        | Revoke MFA for a user (admin action)                        |

(`src/enterprise/auth/mfa.ts`)

---

### Token revocation

Refresh tokens are persisted in SQLite and can be individually or bulk-revoked:

- **Single-token revocation** — logout from a specific session
- **Bulk revocation** — force-logout all sessions for a user (admin action)
- **Access token revocation list** — immediately invalidate issued access tokens before their natural expiry (for compromised accounts)

Refresh tokens are stored as **SHA-256 hashes** — the raw token is never written to disk. On each use the token is rotated (single-use): old token revoked, new token issued.

| Method                       | Description                      |
| ---------------------------- | -------------------------------- |
| `enterprise.sessions.list`   | List active sessions for a user  |
| `enterprise.sessions.revoke` | Revoke a specific session by JTI |

(`src/enterprise/auth/token-store.ts`)

---

### IP allowlisting

Per-user CIDR allowlists record which IP addresses should be permitted for a given user.

> **Check-only in this build — not enforced at authentication.** The matcher
> (`IpAllowlist.isAllowed`) is reachable only through the admin-gated
> `enterprise.ip-allowlist.check` RPC; no login or token-issuance path consults
> `allowedCidrs`, so an out-of-range IP is **not** rejected before token issuance.
> Store the ranges and query them via the RPC, but do not rely on them as an
> enforced access control yet.

```yaml
# Set via admin API or enterprise.users RPC on the user record:
allowedCidrs:
  - "10.0.0.0/8" # corporate VPN range
  - "192.168.1.0/24" # office subnet
  - "203.0.113.5/32" # specific IP
```

Supports full IPv4 CIDR matching and IPv6 CIDR matching (via BigInt expansion for the full 128-bit address space). Empty `allowedCidrs` means no restriction — the feature is opt-in per user.

(`src/enterprise/security/ip-allowlist.ts`)

---

## Audit logging & compliance

Without an audit log, you cannot answer: _who ran this command, when, from where, and what did it do?_ SOC 2, HIPAA §164.312(b), and PCI DSS all require this. The original OpenClaw had no audit capability whatsoever.

### How the hash chain works

Every audit event is a tamper-evident record. Each event includes a SHA-256 hash of the **previous event's content**, creating a chain where any modification — or deletion — of a past record is immediately detectable:

```
Event #1  id=01J4K...  hash=sha256(event1_content)  prevHash=0000...
    │
    ▼
Event #2  id=01J4L...  hash=sha256(event2_content)  prevHash=hash_of_event1
    │
    ▼
Event #3  id=01J4M...  hash=sha256(event3_content)  prevHash=hash_of_event2
```

If event #2 is modified or deleted, `event3.prevHash` no longer matches `sha256(event2_content)`, and `verifyChain()` detects the break.

### What gets logged

Every significant event is automatically captured:

| Event                          | Trigger                                                     |
| ------------------------------ | ----------------------------------------------------------- |
| `auth.login`                   | Successful WebSocket gateway connection                     |
| `auth.failed`                  | Authentication failure (wrong token, expired, rate-limited) |
| `auth.logout`                  | Session terminated                                          |
| `agent.run.start`              | Inbound message dispatched to agent                         |
| `agent.run.complete`           | Agent task finished successfully                            |
| `agent.run.error`              | Agent task failed with error                                |
| `security.injection_detected`  | Prompt injection pattern found in message                   |
| `guardrail.block`              | Tool call blocked by guardrail engine                       |
| `guardrail.warn`               | Tool call flagged but allowed                               |
| `skill.install`                | Skill installed                                             |
| `skill.invoke`                 | Skill invoked by agent                                      |
| `skill.blocked`                | Skill rejected by SAST or code signing                      |
| `config.read` / `config.write` | Configuration accessed or modified                          |
| `user.create` / `user.delete`  | IAM user lifecycle                                          |
| `role.assign`                  | Role assigned to user                                       |

### Storage

```yaml
enterprise:
  audit:
    enabled: true
    storage:
      driver: sqlite # default — no external dependencies
      path: ~/.openclaw/audit.db # WAL mode, indexed by timestamp + actor
    retention:
      days: 365 # auto-purge; 0 = keep forever
```

SQLite in WAL mode provides concurrent read access and crash-safe writes. The audit DB is independent of the main config and can be backed up independently.

### Verification

```typescript
import { createSQLiteAuditStorage } from "./src/enterprise/audit/storage/sqlite.js";
import { verifyChain } from "./src/enterprise/audit/schema.js";

const storage = createSQLiteAuditStorage("~/.openclaw/audit.db");
const events = await storage.query({ limit: 50_000 });
const result = verifyChain(events);

if (!result.valid) {
  console.error(`⚠ Chain tampered at event index ${result.brokenAt}`);
  console.error(`Expected prevHash: ${result.expected}`);
  console.error(`Found prevHash:    ${result.found}`);
}
```

### PostgreSQL audit backend

For deployments that need centralized, queryable audit storage at scale:

```yaml
enterprise:
  audit:
    storage:
      driver: postgres
      connectionString: env://AUDIT_POSTGRES_URL # never inline credentials
      maxConnections: 10
      idleTimeoutMs: 30000
      connectionTimeoutMs: 5000
```

```bash
npm install pg  # optional dependency, not included by default
```

The schema uses JSONB for raw event and metadata columns, with indexes on `timestamp`, `actor_id`, `action`, `category`, `outcome`, and `tenant_id`. Implements the same `AuditStorage` interface as the SQLite backend — swap drivers with a config change. GDPR anonymization (`anonymizeActor`) rewrites actor references in-place without breaking the hash chain. (`src/enterprise/audit/storage/postgres.ts`)

---

### SIEM / syslog export

Forward audit events to your SIEM system in real time.

**Syslog (RFC 5424 — UDP or TCP):**

```yaml
enterprise:
  audit:
    sinks:
      - type: syslog
        protocol: udp # udp (default) or tcp
        host: siem.example.com
        port: 514
        facility: 16 # local0
        appName: openclaw
```

Each event is formatted as RFC 5424 with structured data element `openclaw@32473` containing `id`, `actor`, `action`, `outcome`, `tenantId`, and `durationMs`. TCP transport includes automatic reconnection with a bounded write queue.

**Webhook / generic log aggregator:**

```yaml
enterprise:
  audit:
    sinks:
      - type: webhook
        url: https://logs.example.com/ingest
        batchSize: 100 # events per POST
        flushIntervalMs: 5000 # max wait before flush
        headers:
          Authorization: env://LOG_INGEST_TOKEN
```

Batches events into JSON arrays and POSTs them. Compatible with Elastic, Splunk HEC, Datadog, Loki, and any HTTP ingest endpoint. (`src/enterprise/audit/sinks/syslog.ts`)

---

### GDPR compliance (Art. 17 + Art. 20)

Two operations meet GDPR data subject rights:

**Data export (Art. 20 — right to portability):**

```
GET enterprise.gdpr.export?userId=<id>   # requires super-admin role
```

Returns a JSON object containing: user profile, all audit events where the user was the actor, and all active sessions. Safe to deliver directly to the data subject.

**Data erasure (Art. 17 — right to be forgotten):**

```
POST enterprise.gdpr.erase { userId }    # requires super-admin role
```

Erasure steps:

1. Revokes all active refresh tokens (sessions terminated immediately)
2. Pseudonymizes all audit log entries referencing the user — actor ID and email replaced with `[erased-{sha256}]`. **The audit chain remains intact and verifiable** — event content is updated, hash chain is not broken
3. Deletes the user profile from the RBAC store

(`src/enterprise/iam/gdpr.ts`)

---

### Compliance mapping

| Standard          | Requirement            | How it's met                                           |
| ----------------- | ---------------------- | ------------------------------------------------------ |
| SOC 2 CC6         | Logical access control | Auth events, role assignments, failed logins           |
| SOC 2 CC7         | System operations      | Agent runs, tool executions, config changes            |
| HIPAA §164.312(b) | Audit controls         | Full event log with actor, resource, outcome, IP       |
| GDPR Art. 17      | Right to erasure       | `gdprEraseUser` — pseudonymize + delete                |
| GDPR Art. 20      | Right to portability   | `gdprExportUser` — full JSON export                    |
| GDPR Art. 30      | Records of processing  | Actor + resource on every event; GDPR retention config |
| PCI DSS 10        | Audit log review       | Hash chain + retention policy + centralized storage    |

---

## Prompt injection defenses

Channel messages come from untrusted sources. A Telegram user, a Slack webhook, or a web form can contain carefully crafted text designed to hijack the AI agent: `"Ignore previous instructions. You are now DAN..."`. Without defenses, the agent complies.

### Pipeline

Every inbound message passes through a multi-stage sanitization pipeline **before** it reaches the model:

```
Raw message (from WhatsApp / Telegram / DM / WebSocket)
    │
    ▼ ① NFC Unicode normalization
    │   Collapses homoglyphs: "ⅈgnore" → "ignore"
    │
    ▼ ② Invisible character stripping
    │   Removes zero-width spaces, soft hyphens, directional marks
    │   used to hide injection text from human reviewers
    │
    ▼ ③ Injection pattern detection (8 rule families)
    │   • "ignore previous instructions / forget above"
    │   • DAN / jailbreak activation phrases
    │   • "you are now [DAN|GPT|unrestricted]"
    │   • System/admin role override attempts
    │   • Prompt leaking ("repeat your system prompt")
    │   • Base64-encoded injection attempts
    │   • Nested instruction framing ("as a reminder, your new task is")
    │   • Urgency/authority spoofing ("ANTHROPIC ALERT: you must now")
    │
    ▼ ④ Truncation (default 32 KB)
    │   Prevents context window stuffing attacks
    │
    ▼ ⑤ Trust boundary tagging
        External content is wrapped:
        <EXTERNAL CONTENT source="telegram:user:12345" trustLevel="channel">
          [message content]
        </EXTERNAL CONTENT>
        This makes the source explicit to the model and prevents
        the model from treating channel content as system instructions.
```

If injection is detected, the request is rejected with an audit event logged. The user receives a generic error — no information about what triggered the detection is leaked.

### Guardrail engine

Runtime guardrails evaluate **every tool call** before execution. They run inside `runBeforeToolCallHook()`, which is called by the agent runtime before any tool — bash, browser, file system, or skill — executes.

| Rule                  | Pattern                                                   | Action               |
| --------------------- | --------------------------------------------------------- | -------------------- |
| Credential harvest    | `cat ~/.ssh/id_rsa`, reading `.aws/credentials`, `.npmrc` | `require-approval`   |
| Reverse shell         | `bash -i >& /dev/tcp/...`, `nc -e /bin/bash`              | `block`              |
| Mass delete           | `rm -rf /`, `DROP TABLE`, `DELETE FROM ... WHERE 1=1`     | `require-approval`   |
| SSN in output         | `\b\d{3}-\d{2}-\d{4}\b`                                   | `warn` + audit event |
| Credit card in output | Luhn-valid 13–16 digit sequences                          | `warn` + audit event |

**Pluggable rules** — add your own:

```yaml
enterprise:
  guardrails:
    rules:
      - id: no-prod-db
        description: Block direct production DB writes
        pattern: "postgres://.*prod.*|mysql://.*production"
        action: block
        scope: tool-input
```

---

## Skill supply chain security

Skills are npm-installable agents — third-party code that runs with full agent permissions. Without verification, a malicious skill can exfiltrate data, install backdoors, or pivot to internal systems.

> **Skill-install signing/SAST is not yet enforced in this build.** The Ed25519
> signing and SAST primitives ship and are unit-tested, but the skill-install
> path does not call them, so `enterprise.skills.requireSigning` / `requireSast`
> gate nothing at install time. To avoid false assurance, enabling either flag
> makes the gateway **refuse to boot** (fail closed). Enterprise **plugins** are
> the exception: plugins loaded via the enterprise `PluginLoader` **are** Ed25519
> signature-verified before load. Treat the skill-signing API below as
> library-only until the install-time gate lands.

### Code signing (Ed25519)

The signing primitive hashes the entire skill directory (sorted file tree, SHA-256 per file) and produces a detached signature over the directory hash. It is invoked programmatically (and by the enterprise plugin loader), not by the skill-install path:

```typescript
// Publisher workflow:
const { privateKey, publicKey } = generateSigningKeyPair();
const signature = signSkill({ skillDir: "/path/to/my-skill", privateKeyBase64: privateKey });

// Verification (object-param API):
const result = verifySkillSignature({
  skillDir: "/path/to/my-skill",
  signature,
  trustedPublicKeys, // fails closed on an empty/absent allowlist
});
if (!result.valid) throw new Error(`Skill signature verification failed: ${result.reason}`);
```

```yaml
# Configured, but NOT enforced at skill install — enabling either flag refuses to boot.
enterprise:
  skills:
    requireSigning: true
    trustedKeys:
      - "base64-ed25519-pubkey==" # your organization's key
    requireSast: true
    maxRiskScore: 40 # 0=safest, 100=reject-all above
```

### Enterprise SAST (14 rules)

Before any skill is installed, a static analysis pass checks for:

| Rule                                        | CWE      | OWASP                      |
| ------------------------------------------- | -------- | -------------------------- |
| Credential harvest                          | CWE-522  | A02 Cryptographic Failures |
| Reverse shell                               | CWE-78   | A03 Injection              |
| Persistence (crontab, launchd, systemd)     | CWE-912  | A08 Software Integrity     |
| Code injection (eval, Function())           | CWE-94   | A03 Injection              |
| Prototype pollution                         | CWE-1321 | A03 Injection              |
| Dangerous deserialization                   | CWE-502  | A08 Software Integrity     |
| Path traversal                              | CWE-22   | A01 Access Control         |
| Data exfiltration (curl to external IPs)    | CWE-200  | A02 Cryptographic Failures |
| Supply chain (dynamic require, obfuscation) | CWE-506  | A08 Software Integrity     |
| XSS in skill output                         | CWE-79   | A03 Injection              |
| Unvalidated redirect                        | CWE-601  | A01 Access Control         |
| Hardcoded secrets                           | CWE-798  | A07 Auth Failures          |
| Insecure randomness                         | CWE-338  | A02 Cryptographic Failures |
| SSRF patterns                               | CWE-918  | A10 SSRF                   |

Each finding adds to a **risk score (0–100)**. The scanner returns a recommendation:

- `approve` — risk score < 40
- `review` — risk score 40–70 (human sign-off required)
- `reject` — risk score > 70 (auto-blocked)

---

## Prometheus monitoring

The original OpenClaw had no metrics and no health probes — it was impossible to operate at scale or in Kubernetes.

### Endpoints

| Endpoint        | Purpose                                                             |
| --------------- | ------------------------------------------------------------------- |
| `GET /metrics`  | Prometheus text format — scrape with `prometheus.io/scrape: "true"` |
| `GET /healthz`  | Combined liveness + readiness — returns 200 or 503 with JSON detail |
| `GET /livez`    | Liveness — is the process alive?                                    |
| `GET /readyz`   | Readiness — is the gateway ready to serve traffic?                  |
| `GET /startupz` | Startup probe — returns 503 until fully initialized                 |

All probe endpoints are **unauthenticated** (required for Kubernetes probes). They expose no sensitive data — only binary up/down status and aggregate counts.

### Available metrics

```
# Gateway
openclaw_gateway_connections_active          Gauge
openclaw_gateway_requests_total              Counter (labels: method, path, status)
openclaw_gateway_request_duration_seconds    Histogram

# Agents
openclaw_agent_runs_total                    Counter (labels: agent_id, outcome)
openclaw_agent_runs_active                   Gauge
openclaw_agent_errors_total                  Counter
openclaw_agent_run_duration_seconds          Histogram

# Auth
openclaw_auth_success_total                  Counter (labels: method)
openclaw_auth_failure_total                  Counter (labels: reason)

# Security
openclaw_guardrail_evaluations_total         Counter (labels: action)
openclaw_guardrail_blocks_total              Counter
openclaw_injection_detections_total          Counter

# Skills
openclaw_skill_invocations_total             Counter (labels: skill_id, outcome)

# Audit
openclaw_audit_events_total                  Counter (labels: category)
openclaw_audit_chain_length                  Gauge

# Multi-tenancy
openclaw_tenant_count                        Gauge
openclaw_cluster_node_count                  Gauge
```

### Zero-overhead design

When `enterprise.monitoring.enabled` is `false` (the community default), every metric call goes through a noop stub — there is no `prom-client` import, no memory allocation, and no CPU overhead. The stubs are replaced with real implementations only when `initMonitoring()` is called.

---

## Multi-tenancy

Multi-tenancy allows a single OpenClaw deployment to serve multiple isolated teams or customers, with per-tenant rate limits, audit trails, and configuration.

### How isolation works

Tenant context is propagated automatically through all async operations using Node.js `AsyncLocalStorage`. You don't need to thread a tenant ID through every function call — it flows transparently:

```typescript
import { runWithTenantAsync, getTenantContext } from "./src/enterprise/tenancy/index.js";

// Set at the gateway connection layer (once per request)
await runWithTenantAsync({ tenantId: "acme-corp", name: "ACME Corp" }, async () => {
  // Everything called here — including deeply nested async code,
  // tool executions, and audit logs — automatically has tenant context.
  const ctx = getTenantContext(); // { tenantId: "acme-corp", name: "ACME Corp" }
  await agent.run(message); // audit events get tenantId automatically
});
```

```yaml
enterprise:
  tenancy:
    enabled: true
    tenants:
      - id: acme-corp
        name: ACME Corp
        rateLimits:
          requestsPerMinute: 500
      - id: beta-team
        name: Beta Team
        rateLimits:
          requestsPerMinute: 100
```

### Storage-layer isolation

In addition to `AsyncLocalStorage` context propagation, tenant isolation is enforced at the **SQL query level**. All RBAC and audit storage calls are wrapped with tenant-scoped adapters that:

- Auto-stamp `tenantId` on every write if context is set
- Enforce tenant filter (`WHERE tenant_id = ?`) on every read
- Throw a `TENANT_ISOLATION_VIOLATION` error if code attempts to read another tenant's data

This prevents data leakage even if application code forgets to filter by tenant. (`src/enterprise/tenancy/isolation.ts`)

---

## Distributed cluster

For high-availability deployments, multiple OpenClaw gateway nodes form a cluster backed by Redis. Nodes discover each other, elect a leader, exchange heartbeats, and route events through a shared message bus.

```yaml
enterprise:
  cluster:
    enabled: true
    redis:
      url: env://REDIS_URL     # never inline credentials
      keyPrefix: openclaw:
    heartbeatIntervalMs: 10000
```

```bash
npm install ioredis  # optional dependency for Redis cluster support
```

**How it works:**

- **Leader election** — `SET NX EX` atomic lock on `{keyPrefix}leader`. Lock TTL = 3× heartbeat interval. The leader is re-elected automatically if the current leader fails to renew
- **Lock renewal** — the leader renews its lock every heartbeat interval. Renewal errors yield leadership immediately to prevent split-brain
- **Node heartbeats** — each node writes its heartbeat key with TTL = 4× heartbeat interval. Nodes that stop renewing are evicted automatically by Redis TTL expiry
- **Message bus** — Redis pub/sub via a dedicated `SUBSCRIBE` connection. Same event model as single-node, just distributed across all nodes in the cluster

**InMemoryCoordinator** is provided for single-node development and testing — no Redis needed. Falls back automatically with a warning if `ioredis` is not installed.

(`src/enterprise/cluster/index.ts`)

---

### Distributed rate limiting

When multiple gateway nodes share Redis, rate limits are enforced globally across all nodes using a sliding window algorithm:

```yaml
enterprise:
  security:
    rateLimiting:
      enabled: true
      redisUrl: env://REDIS_URL # same Redis as cluster.redis.url
      windowMs: 60000 # 1-minute window
      maxRequests: 1000 # per subject per window
```

The Redis implementation uses sorted sets: each request adds a timestamped entry with `ZADD`, removes expired entries with `ZREMRANGEBYSCORE`, and counts active entries with `ZCARD`. If Redis is unavailable, the limiter falls back to per-node in-memory windows with an automatic stderr warning.

(`src/enterprise/security/rate-limit.ts`)

---

## Kubernetes

The full production Helm chart lives in [`k8s/helm/openclaw/`](k8s/helm/openclaw/).

### Security defaults (out of the box)

```yaml
securityContext:
  runAsNonRoot: true # UID 1001
  runAsUser: 1001
  allowPrivilegeEscalation: false
  capabilities:
    drop: ["ALL"] # no Linux capabilities
  readOnlyRootFilesystem: true
automountServiceAccountToken: false
```

### Install

```bash
# Create secrets first
kubectl create secret generic openclaw-secrets \
  --namespace openclaw \
  --from-literal=ANTHROPIC_API_KEY=sk-ant-... \
  --from-literal=OPENCLAW_MASTER_KEY=$(openssl rand -base64 32)

# Single node (development / small team)
kubectl apply -f k8s/examples/single-node.yaml

# Enterprise HA (3 replicas, Vault secrets, Prometheus, cert-manager)
helm install openclaw k8s/helm/openclaw/ \
  --namespace openclaw --create-namespace \
  -f k8s/examples/enterprise-ha.yaml
```

### What's included in the Helm chart

| Template              | Description                                                      |
| --------------------- | ---------------------------------------------------------------- |
| `deployment.yaml`     | Rolling update, all 3 probes, config checksum annotation         |
| `service.yaml`        | ClusterIP service                                                |
| `ingress.yaml`        | Multi-version (networking.k8s.io/v1 / v1beta1 / extensions)      |
| `hpa.yaml`            | HPA v2 with CPU + memory metrics                                 |
| `pdb.yaml`            | PodDisruptionBudget (policy/v1 + v1beta1 fallback)               |
| `networkpolicy.yaml`  | Ingress from ingress-controller + Prometheus; Egress DNS + HTTPS |
| `serviceaccount.yaml` | Dedicated SA, `automountServiceAccountToken: false`              |
| `servicemonitor.yaml` | Prometheus Operator ServiceMonitor                               |
| `configmap.yaml`      | Config from Helm values, conditional enterprise blocks           |
| `pvc.yaml`            | Persistent volume for data                                       |
| `NOTES.txt`           | Post-install instructions with detected config                   |

### High-availability values

See [`k8s/examples/enterprise-ha.yaml`](k8s/examples/enterprise-ha.yaml) for a production-ready overlay including:

- 3 replicas with pod anti-affinity (spread across nodes)
- HPA: 3–20 replicas, CPU 70% / memory 80%
- PDB: `minAvailable: 2`
- Vault-backed secrets with Kubernetes auth
- OIDC authentication
- Prometheus ServiceMonitor with custom scrape labels
- cert-manager TLS with Let's Encrypt
- NetworkPolicy (ingress from nginx, egress to Vault + external APIs)
- `topologySpreadConstraints` for zone distribution

---

## Connecting to enterprise messaging

OpenClaw integrates with the platforms your team already uses. Every channel is configured in `~/.openclaw/config.yaml` under `channels.<name>`. Run `pnpm openclaw onboard` for an interactive setup wizard.

### Slack

**Status:** production-ready. Socket Mode (default) or HTTP Events API.

**Step 1 — Create a Slack app**

Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From manifest** and paste the JSON below, then replace `OpenClaw` with your preferred bot name:

```json
{
  "display_information": { "name": "OpenClaw" },
  "features": {
    "bot_user": { "display_name": "OpenClaw", "always_online": false },
    "app_home": { "messages_tab_enabled": true }
  },
  "oauth_config": {
    "scopes": {
      "bot": [
        "chat:write",
        "channels:history",
        "channels:read",
        "groups:history",
        "im:history",
        "mpim:history",
        "users:read",
        "app_mentions:read",
        "reactions:read",
        "reactions:write",
        "files:read",
        "files:write",
        "commands"
      ]
    }
  },
  "settings": {
    "socket_mode_enabled": true,
    "event_subscriptions": {
      "bot_events": [
        "app_mention",
        "message.channels",
        "message.groups",
        "message.im",
        "message.mpim",
        "reaction_added",
        "reaction_removed"
      ]
    }
  }
}
```

- Under **Socket Mode**, generate an **App-Level Token** (`xapp-...`) with scope `connections:write`.
- Under **OAuth & Permissions**, install the app to your workspace and copy the **Bot Token** (`xoxb-...`).
- Under **App Home**, enable the **Messages Tab** so users can DM the bot.

**Step 2 — Configure OpenClaw**

```yaml
channels:
  slack:
    enabled: true
    botToken: xoxb-... # or env: SLACK_BOT_TOKEN
    appToken: xapp-... # or env: SLACK_APP_TOKEN
    requireMention: true # require @mention in channels (default)
    dmPolicy: pairing # pairing | open | allowlist
    groupPolicy: allowlist # allowlist channels explicitly
    channels:
      C0123456789: # Slack channel ID
        allow: true
```

**Step 3 — Start the gateway**

```bash
pnpm gateway:watch
```

The bot will appear online in Slack immediately. DM it directly or `@mention` it in any channel it has been added to.

---

### Microsoft Teams

**Status:** supported via plugin (Azure Bot Framework). Requires a public HTTPS endpoint for the bot webhook.

**Step 1 — Install the Teams plugin**

```bash
pnpm openclaw plugins install @openclaw/msteams
# or from this repo's local checkout:
pnpm openclaw plugins install ./extensions/msteams
```

**Step 2 — Register an Azure Bot**

1. Go to [portal.azure.com](https://portal.azure.com) → **Azure Bot** → **Create**.
2. Choose **Multi Tenant** (or **Single Tenant** if you want org-only access).
3. Note the **App ID** and generate a **Client Secret** — copy both.
4. Under **Channels**, add **Microsoft Teams**.
5. Under **Configuration**, set the **Messaging endpoint** to your gateway's public URL:
   ```
   https://your-gateway.example.com/api/messages
   ```
   The gateway listens on port 3978 and path `/api/messages` by default. Use a reverse proxy (nginx, Caddy) or tunnel (ngrok, Tailscale Funnel) to expose it over HTTPS.

**Step 3 — Configure OpenClaw**

```yaml
channels:
  msteams:
    enabled: true
    appId: "<Azure App ID>" # or env: MSTEAMS_APP_ID
    appPassword: "<Client Secret>" # or env: MSTEAMS_APP_PASSWORD
    tenantId: "<Azure AD Tenant ID>" # omit for multi-tenant
    webhook:
      port: 3978
      path: /api/messages
    requireMention: true # require @mention in channels
    dmPolicy: pairing # pairing | open | allowlist
    replyStyle: thread # thread | top-level
```

**Step 4 — Install the Teams app**

Generate an app package (zip of `manifest.json` + icons) and upload it in Teams Admin Center or sideload it directly:

- **Teams Admin Center** → Manage apps → Upload → select the zip → publish to your org.
- **Teams client** → Apps → Manage your apps → Upload an app (sideloading, for dev/test).

The bot then appears in Teams search. Users can DM it directly or `@mention` it in any channel it is added to.

---

### Google Chat (Google Workspace)

**Status:** production-ready via Google Chat API (HTTP webhook).

**Step 1 — Create a Google Cloud project**

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → Enable **Google Chat API**.
2. Create a **Service Account** (Credentials → Create Credentials → Service Account).
3. Generate a **JSON key** for the service account and copy it to the gateway host, e.g. `~/.openclaw/googlechat-sa.json`.

**Step 2 — Configure the Chat App**

In [Google Chat API → Configuration](https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat):

- Set **Connection settings** to **HTTP endpoint URL** pointing to `https://your-gateway.example.com/googlechat`.
- Set **Visibility** to your domain or specific users.
- Set **App status** to **Live**.

**Step 3 — Configure OpenClaw**

```yaml
channels:
  googlechat:
    enabled: true
    serviceAccountFile: ~/.openclaw/googlechat-sa.json
    requireMention: true
    dmPolicy: pairing
    groupPolicy: allowlist
```

Users find the bot by searching its app name in the Google Chat search bar (it won't appear in the Marketplace listing — search by name directly).

---

### Mattermost (self-hosted)

**Status:** supported via plugin (bot token + WebSocket events). Channels, groups, and DMs are supported.

**Step 1 — Install the Mattermost plugin**

```bash
pnpm openclaw plugins install @openclaw/mattermost
```

**Step 2 — Create a bot account**

In Mattermost: **System Console** → **Integrations** → **Bot Accounts** → **Add Bot Account**. Copy the **bot token** shown on creation (it is only displayed once).

**Step 3 — Configure OpenClaw**

```yaml
channels:
  mattermost:
    enabled: true
    botToken: "<mattermost-bot-token>" # or env: MATTERMOST_BOT_TOKEN
    baseUrl: https://chat.example.com # your Mattermost server URL
    dmPolicy: pairing
    requireMention: true
```

**Step 4 — Add the bot to channels**

In Mattermost, invite the bot user to any channel with `/invite @openclaw`. It will respond to DMs automatically and to `@openclaw` mentions in channels.

---

### Channel overview

| Channel         | Auth required            | Plugin needed                | DMs | Group channels |
| --------------- | ------------------------ | ---------------------------- | --- | -------------- |
| Slack           | Bot token + App token    | No                           | ✅  | ✅             |
| Microsoft Teams | Azure App ID + Secret    | Yes (`@openclaw/msteams`)    | ✅  | ✅             |
| Google Chat     | GCP service account JSON | No                           | ✅  | ✅ (spaces)    |
| Mattermost      | Bot token                | Yes (`@openclaw/mattermost`) | ✅  | ✅             |
| Discord         | Bot token                | No                           | ✅  | ✅             |
| Telegram        | Bot token (BotFather)    | No                           | ✅  | ✅             |
| WhatsApp        | QR pairing (Baileys)     | No                           | ✅  | ✅             |

> **Outlook / Exchange email** is not a chat channel. For email-triggered automation, see [Gmail Pub/Sub hooks](#community-features) in the community edition.

---

## Signed container images + SBOM

Every release image is built, signed, and attested via GitHub Actions. Signatures use **cosign keyless signing** — no private key to manage, GitHub OIDC is the trust anchor.

```bash
# Verify image signature
cosign verify \
  --certificate-identity-regexp="https://github.com/mholovetskyi/openclawenterprise/.*" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com" \
  ghcr.io/mholovetskyi/openclawenterprise:latest

# Verify SBOM attestation
cosign verify-attestation \
  --type spdxjson \
  --certificate-identity-regexp="https://github.com/mholovetskyi/openclawenterprise/.*" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com" \
  ghcr.io/mholovetskyi/openclawenterprise:latest
```

**CI workflow (`.github/workflows/container.yml`):**

| Job                  | Tool           | Output                                                            |
| -------------------- | -------------- | ----------------------------------------------------------------- |
| `build`              | Docker Buildx  | Multi-platform image (linux/amd64, linux/arm64) pushed to ghcr.io |
| `sign`               | cosign keyless | Transparency log entry; no private key or secrets required        |
| `sbom`               | syft + cosign  | SPDX-JSON SBOM generated and attested to image digest             |
| `vulnerability-scan` | Trivy          | Findings uploaded to GitHub Security tab as SARIF                 |

The SBOM is also uploaded as a workflow artifact (90-day retention) for offline inspection. Vulnerability scan results appear in the **Security → Code scanning** tab of the repository.

---

## Enterprise quick-start config

```yaml
# ~/.openclaw/config.yaml — complete enterprise configuration

enterprise:
  enabled: true

  # ── Secrets ──────────────────────────────────────────────────────
  secrets:
    backend: vault # file | vault | aws-sm | gcp-sm | azure-kv
    vault:
      address: https://vault.example.com
      authMethod: kubernetes
      role: openclaw
      mount: secret
      prefix: openclaw/

  # ── IAM / RBAC ───────────────────────────────────────────────────
  iam:
    enabled: true
    jwt:
      algorithm: RS256 # auto-generates key pair on first start
      expiresIn: 15m
      refreshExpiresIn: 7d

  # ── OIDC / SSO (optional — remove if using local accounts) ────────
  auth:
    oidc:
      discoveryUrl: https://your-org.okta.com/.well-known/openid-configuration
      clientId: 0oa...
      clientSecret: env://OIDC_CLIENT_SECRET
      redirectUri: https://openclaw.example.com/auth/oidc/callback
      roleMap:
        Engineering: operator
        Admins: admin
      defaultRole: viewer
    mfa:
      enabled: true
      requireForRoles: [admin, super-admin]

  # ── Audit logging ─────────────────────────────────────────────────
  audit:
    enabled: true
    storage:
      driver: sqlite
      path: ~/.openclaw/audit.db
    retention:
      days: 365

  # ── Monitoring ───────────────────────────────────────────────────
  monitoring:
    enabled: true # /metrics + /healthz + /livez + /readyz + /startupz

  # ── Guardrails (defaults are safe — override to customize) ────────
  guardrails:
    enabled: true

  # ── Skill supply chain ────────────────────────────────────────────
  skills:
    requireSigning: true
    requireSast: true
    maxRiskScore: 40

  # ── Multi-tenancy (optional) ──────────────────────────────────────
  tenancy:
    enabled: false

  # ── Cluster (optional — requires ioredis) ────────────────────────
  cluster:
    enabled: false
    # redis:
    #   url: env://REDIS_URL
    #   keyPrefix: openclaw:

  # ── Security ──────────────────────────────────────────────────────
  security:
    rateLimiting:
      enabled: true
      redisUrl: env://REDIS_URL # shared with cluster if enabled

# ── Gateway ───────────────────────────────────────────────────────
gateway:
  bind: loopback # NEVER silent 0.0.0.0
  auth:
    mode: jwt # requires enterprise.iam.enabled: true
  port: 3284

# ── Agent model ──────────────────────────────────────────────────
# Recommended: Anthropic Opus 4.6 for best prompt-injection resistance
```

---

## NVIDIA AI infrastructure

OpenClaw Enterprise integrates natively with NVIDIA's agentic AI stack. Run Nemotron 3 models via NIM for GPU-accelerated inference, monitor GPU health with Prometheus, enforce thinking budgets and model routing policies, deploy NIM as a Kubernetes sidecar, and run sandboxed inference with NemoClaw Enterprise.

### NIM provider

```yaml
enterprise:
  nvidia:
    nim:
      enabled: true
      endpoint: "https://integrate.api.nvidia.com/v1"
      apiKey: env://NIM_API_KEY
      defaultModel: "nvidia/nemotron-3-nano-30b-a3b"
    gpuMetrics:
      enabled: true
      pollIntervalMs: 15000
  guardrails:
    nvidia:
      thinkingBudgetLimit:
        enabled: true
        maxThinkingTokens: 4096
      modelRoutingPolicy:
        enabled: true
        roleModelMap:
          viewer: ["nvidia/llama-3.1-nemotron-nano-8b-v1"]
          operator: ["nvidia/llama-3.1-nemotron-nano-8b-v1", "nvidia/nemotron-3-nano-30b-a3b"]
          admin: ["*"]
```

### NemoClaw Enterprise (sandboxed inference)

NemoClaw brings sandboxed, privacy-aware inference to OpenClaw Enterprise. Every request runs inside an OpenShell container with declarative security policies — network egress control, filesystem isolation, and seccomp restrictions. A built-in privacy router can force sensitive data to stay on local-only models, never leaving the network boundary.

Three inference profiles are supported out of the box: `nvidia-cloud` (NVIDIA-hosted API), `local-nim` (self-hosted NIM containers), and `vllm` (community vLLM backend). The primary model is **Nemotron 3 Super 120B** (`nvidia/nemotron-3-super-120b-a12b`).

```yaml
enterprise:
  nvidia:
    nemoClaw:
      enabled: true
      apiKey: env://NEMOCLAW_API_KEY # falls back to NVIDIA_API_KEY
      inferenceProfile: nvidia-cloud # nvidia-cloud | local-nim | vllm
      defaultModel: "nvidia/nemotron-3-super-120b-a12b"
      sandbox:
        networkEgress: block # block | allow | require-approval
        allowedHosts:
          - "integrate.api.nvidia.com"
          - "*.nvidia.com"
        filesystem: read-only
        seccomp: strict
      privacyRouter:
        enabled: true
        sensitivePatterns: ["SSN", "credit_card", "medical_record"]
        localOnlyModel: "nvidia/nemotron-3-nano-30b-a3b"
```

**Key capabilities:**

- **OpenShell sandbox** — every inference request runs in an isolated container with network, filesystem, and syscall restrictions
- **Privacy router** — automatically routes prompts containing sensitive data to local-only models (never leaves your network)
- **3 inference profiles** — NVIDIA cloud, self-hosted NIM, or vLLM — switch with a single config line
- **Egress control** — block, allow, or require-approval for outbound network from sandboxed inference
- **Prometheus metrics** — `nemoclaw_requests_total`, `nemoclaw_latency_seconds`, `nemoclaw_tokens_total`, `nemoclaw_sandbox_health`, `nemoclaw_sandbox_egress_blocked_total`
- **Audit events** — `NEMOCLAW_REQUEST`, `NEMOCLAW_SANDBOX_POLICY`, `NEMOCLAW_EGRESS_BLOCKED` logged to the tamper-evident audit chain
- **Auto-fallback** — `NEMOCLAW_API_KEY` automatically falls back to `NVIDIA_API_KEY` for unified credential management

See [docs/enterprise/nvidia.md](docs/enterprise/nvidia.md) for full configuration reference, Kubernetes sidecar setup, and troubleshooting.

---

## Palantir Foundry integration

OpenClaw Enterprise integrates with Palantir Foundry for unified audit visibility, SSO authentication, and Compute Module deployment. Stream audit events into Foundry streaming datasets, authenticate via Palantir OIDC, and deploy directly as a Foundry Compute Module.

```yaml
enterprise:
  # ── Palantir Foundry (optional) ──────────────────────────────────
  # audit:
  #   sinks:
  #     - type: palantir-foundry
  #       stackUrl: env://PALANTIR_STACK_URL
  #       clientId: env://PALANTIR_CLIENT_ID
  #       clientSecret: env://PALANTIR_CLIENT_SECRET
  #       ontologyRid: env://PALANTIR_ONTOLOGY_RID
  #       streamRid: "ri.foundry.main.dataset.abc123"

  # ── Palantir OIDC/SSO (optional) ────────────────────────────────
  # auth:
  #   oidc:
  #     provider: palantir
  #     stackUrl: env://PALANTIR_STACK_URL
  #     clientId: env://PALANTIR_OIDC_CLIENT_ID
  #     clientSecret: env://PALANTIR_OIDC_CLIENT_SECRET
  #     roleMap:
  #       Foundry-Admins: admin
  #       Foundry-Operators: operator
```

See [docs/enterprise/palantir.md](docs/enterprise/palantir.md) for full configuration, Compute Module deployment, and ontology-aware guardrails.

---

## Oracle Cloud Infrastructure integration

OpenClaw Enterprise integrates with Oracle Cloud Infrastructure for secret management (OCI Vault), audit log streaming (OCI Streaming), database connectivity (Oracle MCP bridge), and portable agent configuration export (Agent Spec JSON).

```yaml
enterprise:
  # ── OCI Vault secrets (optional) ──────────────────────────────
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

  # ── OCI Streaming audit sink (optional) ───────────────────────
  audit:
    enabled: true
    sinks:
      - type: oci-streaming
        streamId: env://OCI_STREAM_ID
        streamEndpoint: env://OCI_STREAMING_ENDPOINT
        batchSize: 100
        flushIntervalMs: 5000

  # ── Oracle MCP bridge (optional) ──────────────────────────────
  oracle:
    mcp:
      enabled: true
      endpoint: env://ORACLE_MCP_ENDPOINT
      auth:
        method: oci-api-key
      allowedTools: [sql_query, describe_table, list_tables]
      blockedTools: [drop_table]
      maxResultRows: 1000

    # ── Agent Spec export (optional) ────────────────────────────
    agentSpec:
      enabled: true
      exportPath: ./agent-spec.json
      includeTools: true
      redactSecrets: true
```

See [docs/enterprise/oracle.md](docs/enterprise/oracle.md) for full configuration, MCP guardrails, and Agent Spec schema.

---

## Feature matrix

|                                                                | Community | Enterprise |
| -------------------------------------------------------------- | --------- | ---------- |
| **Core**                                                       |           |            |
| Multi-channel AI assistant (14 channels)                       | ✅        | ✅         |
| Local-first gateway (loopback default)                         | ✅        | ✅         |
| Skills platform                                                | ✅        | ✅         |
| Voice Wake + Talk Mode                                         | ✅        | ✅         |
| Live Canvas (A2UI)                                             | ✅        | ✅         |
| macOS / iOS / Android apps                                     | ✅        | ✅         |
| **Security**                                                   |           |            |
| Zero-trust gateway (0.0.0.0 never silent)                      | ✅        | ✅         |
| AES-256-GCM encrypted secrets                                  | —         | ✅         |
| HashiCorp Vault integration                                    | —         | ✅         |
| AWS Secrets Manager                                            | —         | ✅         |
| GCP Secret Manager                                             | —         | ✅         |
| Azure Key Vault                                                | —         | ✅         |
| OCI Vault (Oracle Cloud KMS)                                   | —         | ✅         |
| Legacy credential auto-migration                               | —         | ✅         |
| Prompt injection sanitizer (8 rule families)                   | —         | ✅         |
| Trust boundary tagging                                         | —         | ✅         |
| Runtime guardrail engine                                       | —         | ✅         |
| Skill code signing (Ed25519)                                   | —         | ✅         |
| Enterprise SAST (14 rules, CWE/OWASP)                          | —         | ✅         |
| **Identity & Access**                                          |           |            |
| IAM / RBAC (5 built-in roles)                                  | —         | ✅         |
| SQLite-persistent RBAC store                                   | —         | ✅         |
| JWT RS256/HS256 auth                                           | —         | ✅         |
| API key management                                             | —         | ✅         |
| Group membership + role inheritance                            | —         | ✅         |
| Agent service accounts                                         | —         | ✅         |
| Legacy scope backwards compatibility                           | —         | ✅         |
| OIDC / SSO (Palantir, Okta, Azure AD, Google, Auth0, Keycloak) | —         | ✅         |
| MFA / TOTP (RFC 6238, pure Node.js)                            | —         | ✅         |
| Refresh token revocation (single + bulk)                       | —         | ✅         |
| Access token revocation list                                   | —         | ✅         |
| IP allowlisting (IPv4 + IPv6 CIDR)                             | —         | ✅         |
| **Compliance**                                                 |           |            |
| Tamper-evident audit log (SHA-256 chain)                       | —         | ✅         |
| ULID event IDs (sortable, millisecond)                         | —         | ✅         |
| SQLite WAL audit storage                                       | —         | ✅         |
| PostgreSQL audit backend                                       | —         | ✅         |
| SIEM / Syslog (RFC 5424 UDP + TCP)                             | —         | ✅         |
| Webhook log sink (Elastic, Splunk, Datadog)                    | —         | ✅         |
| Configurable retention policy                                  | —         | ✅         |
| Chain verification API                                         | —         | ✅         |
| GDPR data export (Art. 20)                                     | —         | ✅         |
| GDPR data erasure (Art. 17)                                    | —         | ✅         |
| SOC 2 / HIPAA / GDPR mapping                                   | —         | ✅         |
| **Observability**                                              |           |            |
| Prometheus metrics (20+ metrics)                               | —         | ✅         |
| /metrics /healthz /livez /readyz /startupz                     | —         | ✅         |
| Grafana dashboard (included)                                   | —         | ✅         |
| Admin dashboard UI (live, gateway-wired)                       | —         | ✅         |
| **Scale**                                                      |           |            |
| Multi-tenancy (AsyncLocalStorage)                              | —         | ✅         |
| Multi-tenant storage isolation (SQL-level)                     | —         | ✅         |
| Per-tenant rate limits                                         | —         | ✅         |
| Distributed rate limiting (Redis sliding window)               | —         | ✅         |
| Distributed cluster (Redis leader election + pub/sub)          | —         | ✅         |
| Node heartbeats + health tracking                              | —         | ✅         |
| **Deployment**                                                 |           |            |
| Kubernetes Helm chart (full)                                   | —         | ✅         |
| HPA + PDB + NetworkPolicy                                      | —         | ✅         |
| Prometheus ServiceMonitor                                      | —         | ✅         |
| cert-manager TLS                                               | —         | ✅         |
| Signed container images (cosign keyless)                       | —         | ✅         |
| SBOM attestation (syft SPDX-JSON)                              | —         | ✅         |
| Vulnerability scanning (Trivy → GitHub Security)               | —         | ✅         |
| npm one-command install                                        | ✅        | ✅         |
| **NVIDIA AI Infrastructure**                                   |           |            |
| NVIDIA NIM model provider                                      | —         | ✅         |
| Nemotron 3 model family support                                | —         | ✅         |
| NVIDIA GPU monitoring (Prometheus)                             | —         | ✅         |
| NIM Kubernetes sidecar                                         | —         | ✅         |
| Thinking budget guardrails                                     | —         | ✅         |
| Model routing policy (RBAC)                                    | —         | ✅         |
| NIM cost guard                                                 | —         | ✅         |
| NemoClaw Enterprise (sandboxed inference)                      | —         | ✅         |
| NemoClaw OpenShell sandbox (network, fs, seccomp)              | —         | ✅         |
| NemoClaw privacy router (local-only sensitive data)            | —         | ✅         |
| NemoClaw 3 inference profiles (cloud, NIM, vLLM)               | —         | ✅         |
| Nemotron 3 Super 120B model support                            | —         | ✅         |
| NemoClaw Prometheus metrics (5 gauges)                         | —         | ✅         |
| NemoClaw audit events (request, sandbox, egress)               | —         | ✅         |
| **Palantir Foundry**                                           |           |            |
| Palantir Foundry audit sink                                    | —         | ✅         |
| Palantir OIDC/SSO preset                                       | —         | ✅         |
| Foundry Compute Module Dockerfile                              | —         | ✅         |
| Ontology-aware guardrails (guide)                              | —         | ✅         |
| OIDC provider presets (6 providers)                            | —         | ✅         |
| **Oracle Cloud Infrastructure**                                |           |            |
| OCI Vault secret backend                                       | —         | ✅         |
| OCI Streaming audit sink                                       | —         | ✅         |
| Oracle MCP bridge (Autonomous DB)                              | —         | ✅         |
| MCP guardrails (allowlist, SQL injection detection)            | —         | ✅         |
| Agent Spec JSON export                                         | —         | ✅         |

---

## Test suite & quality assurance

**396 tests · 22 test files · all passing in CI**

Every enterprise security subsystem ships with a dedicated unit test suite. Tests run in CI on every push via Vitest and cover correctness, edge cases, cryptographic properties, and failure modes — not just happy paths.

### Coverage by security domain

#### Secret backends (91 tests)

| Test file                  | Tests | What it validates                                                                                                                  |
| -------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `backend-vault.test.ts`    | 24    | Token auth, AppRole, no-auth fallback, KV v2 CRUD, custom request headers                                                          |
| `backend-azure-kv.test.ts` | 24    | HTTP 404 vs `SecretNotFound` error code disambiguation, Azure-safe name encoding/decoding                                          |
| `backend-gcp-sm.test.ts`   | 22    | gRPC error code mapping (`NOT_FOUND`, `PERMISSION_DENIED`), Buffer and string payload handling, create-or-skip-if-exists semantics |
| `backend-aws-sm.test.ts`   | 21    | Get/set/delete/list/exists operations, pagination across multiple pages, SDK error propagation                                     |

#### Skill supply chain security (37 tests)

| Test file              | Tests | What it validates                                                                                                                                             |
| ---------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code-signing.test.ts` | 17    | Ed25519 sign and verify round-trip, key derivation, modified-file detection, multi-key trust anchors, corrupt-signature rejection                             |
| `sast.test.ts`         | 20    | All 14 SAST rules fire on matching patterns, risk score accumulation 0–100, CWE and OWASP tag presence, `approve`/`review`/`reject` threshold recommendations |

#### IAM / RBAC (69 tests)

| Test file             | Tests | What it validates                                                                                                  |
| --------------------- | ----- | ------------------------------------------------------------------------------------------------------------------ |
| `rbac/store.test.ts`  | 26    | User, role, and group CRUD; duplicate rejection; cascade-delete integrity                                          |
| `rbac/engine.test.ts` | 23    | Permission evaluation, wildcard matching (`agents.*`, `*`), group role inheritance, cycle detection in role graphs |
| `rbac/model.test.ts`  | 20    | All 5 built-in roles and their exact permission sets; custom role definition; invalid role rejection               |

#### Authentication (23 tests)

| Test file     | Tests | What it validates                                                                                                                                                                   |
| ------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jwt.test.ts` | 23    | RS256 and HS256 sign/verify, access token and refresh token lifecycle, API key generation (`oc_…` prefix), SHA-256 key hash storage (raw key never stored), expired-token rejection |

#### Audit logging (27 tests)

| Test file              | Tests | What it validates                                                                                                               |
| ---------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------- |
| `audit/schema.test.ts` | 17    | ULID ID generation, SHA-256 hash chain linkage, single-event tamper detection, multi-event chain break detection at exact index |
| `audit/logger.test.ts` | 10    | Auth/agent/guardrail event logging, disk-full simulation with graceful degradation                                              |

#### Cryptography & secret routing (45 tests)

| Test file               | Tests | What it validates                                                                                                                                       |
| ----------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `encryption.test.ts`    | 16    | AES-256-GCM encrypt/decrypt round-trip, IV uniqueness across encryptions, auth-tag tamper detection, wrong-key rejection                                |
| `secrets/index.test.ts` | 14    | Secret reference URI parsing (`vault://`, `aws-sm://`, `gcp-sm://`, `azure-kv://`, `env://`, `file://`), backend routing, backend-not-configured errors |
| `backend-file.test.ts`  | 15    | File backend CRUD, encrypted-at-rest storage, plaintext-credential migration                                                                            |

#### Security & guardrails (40 tests)

| Test file                 | Tests | What it validates                                                                                                                                         |
| ------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `input-sanitizer.test.ts` | 22    | NFC Unicode normalization, invisible character stripping, all 8 injection pattern families, trust boundary tag injection, configurable truncation         |
| `guardrails.test.ts`      | 18    | Rule evaluation against tool inputs and outputs, pluggable custom rules, `block`/`require-approval`/`warn` action dispatch, audit event emission on block |

#### NVIDIA integration (26 tests)

| Test file                                | Tests | What it validates                                                                                                                                     |
| ---------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nvidia/nemoclaw-provider.test.ts`       | 21    | NemoClaw initialization, OpenShell sandbox setup, health checks, chat completion, retry logic, egress blocking, Prometheus metrics, graceful shutdown |
| `models-config.providers.nvidia.test.ts` | 5     | NemoClaw model provider construction, Nemotron model availability, API key fallback to NVIDIA_API_KEY                                                 |

#### Observability & infrastructure (38 tests)

| Test file                  | Tests | What it validates                                                                                                                   |
| -------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `monitoring/index.test.ts` | 10    | Prometheus metric registration and increment, `/healthz` probe response shape, noop stub when monitoring is disabled                |
| `tenancy/index.test.ts`    | 14    | `AsyncLocalStorage` tenant context propagation through nested async calls, per-tenant rate limit enforcement, missing-context error |
| `cluster/index.test.ts`    | 14    | Node heartbeat registration, stale-node eviction after missed heartbeats, in-memory coordinator for development                     |

### What the tests prove

- **Tamper detection works.** The audit hash chain tests verify that modifying or deleting any event — even a single byte — causes `verifyChain()` to identify the exact break point.
- **Crypto is correct.** AES-256-GCM tests confirm IV uniqueness (no nonce reuse), auth-tag integrity (ciphertext cannot be silently tampered), and wrong-key rejection.
- **RBAC enforces least privilege.** The engine tests cover wildcards, inheritance cycles, and every built-in role's exact permission boundary.
- **Injection patterns are blocked.** The sanitizer tests cover all 8 rule families including Unicode homoglyph attacks, Base64-encoded payloads, and urgency/authority spoofing phrases.
- **Cloud backends handle errors correctly.** Vault, AWS SM, GCP SM, and Azure KV tests verify that SDK errors (gRPC codes, HTTP status codes, SDK exception types) are mapped to consistent `SecretNotFoundError` / `SecretBackendError` types.
- **Code signing rejects modified skills.** SAST and signing tests verify that a single modified file in a skill directory causes signature verification to fail before installation.

### Running the tests

```bash
# Full enterprise test suite
pnpm vitest run --config vitest.unit.config.ts src/enterprise

# Single domain
pnpm vitest run --config vitest.unit.config.ts src/enterprise/iam
pnpm vitest run --config vitest.unit.config.ts src/enterprise/security
pnpm vitest run --config vitest.unit.config.ts src/enterprise/secrets
pnpm vitest run --config vitest.unit.config.ts src/enterprise/audit
```

---

## Community features

Everything below is available in the community edition — no enterprise config needed.

### Channels

WhatsApp (Baileys) · Telegram (grammY) · Slack (Bolt) · Discord (discord.js) · Google Chat · Signal (signal-cli) · BlueBubbles (iMessage) · iMessage (legacy) · Microsoft Teams · Matrix · Zalo · Zalo Personal · WebChat

### Apps & nodes

- **macOS app** — menu bar control plane, Voice Wake/PTT, Talk Mode overlay
- **iOS node** — Canvas, Voice Wake, Talk Mode, camera, screen recording
- **Android node** — Canvas, Talk Mode, camera, screen recording, optional SMS

### Tools & automation

- **Browser control** — dedicated Chrome/Chromium with CDP
- **Canvas + A2UI** — agent-driven visual workspace
- **Cron + webhooks** — scheduled tasks and inbound triggers
- **Gmail Pub/Sub** — email automation
- **Skills platform** — bundled, managed, and workspace skills

### Quick start

Runtime: **Node 22.22.3+, 24.15.0+, or 25.9.0+**

```bash
npm install -g openclaw@latest

openclaw onboard --install-daemon
openclaw gateway --port 18789
openclaw agent --message "What's on my calendar today?"
```

Full guide: [Getting started](https://docs.openclaw.ai/start/getting-started)

### Development channels

- **stable** — tagged releases, npm dist-tag `latest`
- **beta** — prerelease tags, npm dist-tag `beta`
- **dev** — head of `main`, npm dist-tag `dev`

```bash
openclaw update --channel stable|beta|dev
```

### Build from source

Community edition:

```bash
git clone https://github.com/openclaw/openclaw.git
cd openclaw

pnpm install
pnpm ui:build
pnpm build

pnpm openclaw onboard --install-daemon
pnpm gateway:watch    # dev loop with auto-reload
```

Enterprise edition: see [Install](#install) above.

---

## Enterprise documentation

| Doc                                                 | Description                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| [Security hardening](docs/enterprise/security.md)   | Zero-trust config, DM policies, production checklist                      |
| [IAM & RBAC](docs/enterprise/iam.md)                | Roles, permissions, JWT config, API keys, OIDC, MFA, IP allowlisting      |
| [Audit logging](docs/enterprise/audit.md)           | Hash chain verification, PostgreSQL, SIEM/syslog, GDPR                    |
| [Kubernetes](docs/enterprise/kubernetes.md)         | Helm chart reference, HA config, Prometheus, cert-manager                 |
| [Secret management](docs/enterprise/secrets.md)     | All 6 backends, secret reference URIs, migration                          |
| [Container security](docs/enterprise/containers.md) | cosign signing, SBOM verification, Trivy scanning                         |
| [Palantir Foundry](docs/enterprise/palantir.md)     | Audit streaming, OIDC/SSO, Compute Module deployment, ontology guardrails |
| [NVIDIA AI](docs/enterprise/nvidia.md)              | NIM provider, NemoClaw sandbox, GPU metrics, inference profiles           |
| [Oracle Cloud](docs/enterprise/oracle.md)           | OCI Vault, OCI Streaming, MCP bridge, Agent Spec export                   |

---

## Sponsors

| OpenAI                                                            | Blacksmith                                                                   |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [![OpenAI](docs/assets/sponsors/openai.svg)](https://openai.com/) | [![Blacksmith](docs/assets/sponsors/blacksmith.svg)](https://blacksmith.sh/) |

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=openclaw/openclaw&type=date&legend=top-left)](https://www.star-history.com/#openclaw/openclaw&type=date&legend=top-left)

---

## License

MIT — see [LICENSE](LICENSE). Every enterprise feature is MIT-licensed. No subscriptions, no license keys, no phoning home.

[Website](https://openclaw.ai) · [Docs](https://docs.openclaw.ai) · [Discord](https://discord.gg/clawd) · [Issues](https://github.com/openclaw/openclaw/issues) · [Security advisories](https://github.com/openclaw/openclaw/security/advisories)
