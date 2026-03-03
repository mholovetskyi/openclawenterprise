# OpenClaw Enterprise Transformation Plan

## Executive Summary

Transform OpenClaw from a single-user personal AI assistant into a **dual-mode platform** that is simultaneously:

1. **The most viral open-source AI agent** (< 30s wow factor, one-command install, shareable demos)
2. **Fortune 500 production-ready** (zero-trust security, SOC 2/HIPAA/GDPR compliance, multi-tenancy, Kubernetes-native)

All changes remain MIT-licensed. No subscriptions. No pricing. Ever.

### Architecture Philosophy

**"Enterprise is a layer, not a fork."** Every enterprise feature is an _opt-in module_ that activates via configuration. The single-user local-first experience remains the default. Enterprise features compose on top without breaking backwards compatibility.

```
┌──────────────────────────────────────────────────────────┐
│                    USER EXPERIENCE                        │
│  Individual Dev ──→ Team ──→ Department ──→ Enterprise   │
│  (defaults)        (config)   (IAM+RBAC)   (full stack)  │
└──────────────────────────────────────────────────────────┘
```

---

## Phase 1: Security Hardening (Weeks 1-4) — HIGHEST PRIORITY

### 1.1 Zero-Trust Gateway Hardening

**Problem:** Default `0.0.0.0` binding on `lan` mode exposes gateway to all interfaces. Tens of thousands of instances exposed.

**Files to modify:**

- `src/gateway/net.ts` — Change `resolveGatewayBindHost()`
- `src/gateway/server.impl.ts` — Add startup security warnings
- `src/config/types.gateway.ts` — Add `dangerouslyBindAllInterfaces` flag
- `src/config/defaults.ts` — Default to `loopback`

**Changes:**

```
src/gateway/net.ts:
  - Change "lan" mode: require explicit `dangerouslyBindAllInterfaces: true`
  - Default all modes to 127.0.0.1 unless explicitly opted out
  - Add prominent warning when binding 0.0.0.0
  - Add ANSI color warning banner on startup

src/gateway/server.impl.ts:
  - On startup: if bind !== loopback, log SECURITY WARNING with remediation
  - Add `--secure` CLI flag that enforces loopback + TLS + token auth
  - mTLS enforcement when `enterprise.tls.mtls: true`

src/config/defaults.ts:
  - gateway.bind: "loopback" (already default, enforce it)
  - gateway.auth.mode: "token" (already default)
  - NEW: gateway.tls.enabled: false → true when enterprise mode
```

**New files:**

```
src/enterprise/
  ├── index.ts                    — Enterprise feature gate (checks config.enterprise.enabled)
  ├── tls/
  │   ├── mtls.ts                 — Mutual TLS implementation
  │   ├── cert-manager.ts         — Auto-cert rotation, Let's Encrypt integration
  │   └── cert-store.ts           — Certificate storage with encryption at rest
  └── network/
      ├── firewall.ts             — IP allowlist/denylist with CIDR
      └── rate-limiter-advanced.ts — Distributed rate limiting (Redis-backed for multi-node)
```

### 1.2 Secret Management Overhaul

**Problem:** Plaintext secrets in `~/.openclaw/credentials` and config files. Environment variables visible in `ps`.

**Files to modify:**

- `src/agents/cli-credentials.ts` — Replace plaintext file I/O with pluggable secret backend
- `src/config/io.ts` — Add secret reference resolution (`vault://`, `aws-sm://`, `gcp-sm://`)
- `src/config/env-preserve.ts` — Never write resolved secrets back to disk
- `src/infra/shell-env.js` — Add deprecation warning for shell-env secret loading

**New files:**

```
src/enterprise/secrets/
  ├── index.ts                    — Secret manager interface + factory
  ├── backend-file.ts             — Default: encrypted file backend (AES-256-GCM)
  ├── backend-keychain.ts         — macOS Keychain / Windows DPAPI / Linux libsecret
  ├── backend-vault.ts            — HashiCorp Vault integration (KV v2 engine)
  ├── backend-aws-sm.ts           — AWS Secrets Manager integration
  ├── backend-gcp-sm.ts           — GCP Secret Manager integration
  ├── backend-azure-kv.ts         — Azure Key Vault integration
  ├── backend-env.ts              — Environment variable backend (for containers)
  ├── encryption.ts               — AES-256-GCM encrypt/decrypt with key derivation
  ├── key-derivation.ts           — PBKDF2/Argon2id master key derivation
  ├── rotation.ts                 — Automatic secret rotation policies
  └── migration.ts                — Migrate plaintext → encrypted (one-time on upgrade)
```

**Config syntax for secret references:**

```yaml
# config.yaml - secrets never stored in plaintext
models:
  default:
    apiKey: vault://secret/openclaw/openai#api_key
    # OR
    apiKey: aws-sm://openclaw/openai-key
    # OR
    apiKey: encrypted://base64-encrypted-blob
    # OR (legacy, with deprecation warning)
    apiKey: ${OPENAI_API_KEY}
```

**Migration flow on upgrade:**

```
1. Detect ~/.openclaw/credentials (plaintext JSON)
2. Prompt: "Migrate secrets to encrypted storage? [Y/n]"
3. Generate master key from user passphrase (Argon2id)
4. Store master key in OS keychain (macOS Keychain / Windows DPAPI / libsecret)
5. Encrypt all secrets with AES-256-GCM
6. Write encrypted blob to ~/.openclaw/credentials.enc
7. Remove plaintext file
8. Update config.yaml references to encrypted:// URIs
```

### 1.3 Hardened Agent/Skill Sandbox

**Problem:** Skills and agent bash commands run with full host access. No isolation between agents.

**Files to modify:**

- `src/agents/sandbox/config.ts` — Enhance with gVisor/Kata runtime support
- `src/agents/sandbox/docker.ts` — Add security options (seccomp, AppArmor, read-only rootfs)
- `src/agents/sandbox/types.ts` — Add `SandboxIsolationLevel` type
- `src/agents/sandbox/types.docker.ts` — Add security constraint fields
- `src/agents/bash-tools.ts` — Route through sandbox when enterprise mode active
- `src/agents/bash-tools.exec.ts` — Add command allowlist/denylist enforcement

**New files:**

```
src/enterprise/sandbox/
  ├── isolation.ts                — Isolation level resolution (none → container → gVisor → Kata)
  ├── gvisor-runtime.ts           — gVisor runsc integration
  ├── seccomp-profiles/
  │   ├── default.json            — Default seccomp profile (deny dangerous syscalls)
  │   ├── browser.json            — Browser-specific (allows X11, GPU)
  │   └── network-restricted.json — No network access profile
  ├── apparmor-profiles/
  │   ├── openclaw-agent.profile  — Default AppArmor profile
  │   └── openclaw-skill.profile  — Restricted skill profile
  ├── resource-limits.ts          — CPU/memory/disk/network quotas per agent
  ├── network-policy.ts           — Per-agent network rules (egress allowlist)
  └── filesystem-jail.ts          — chroot-like filesystem isolation
```

**Isolation levels (configurable per agent):**

```yaml
enterprise:
  sandbox:
    defaultIsolation: "container" # none | container | gvisor | kata
    agents:
      default:
        isolation: "container"
        resources:
          cpuShares: 1024
          memoryMb: 2048
          diskMb: 5120
          networkEgress:
            allow: ["api.openai.com", "api.anthropic.com"]
            deny: ["*"] # deny-by-default
        seccompProfile: "default"
        readOnlyRootfs: true
        noNewPrivileges: true
```

### 1.4 Prompt Injection Defenses

**Problem:** High susceptibility to prompt injection attacks via channel messages, skill content, web content.

**New files:**

```
src/enterprise/security/
  ├── input-sanitizer.ts          — Sanitize user inputs before LLM processing
  │                                 - Strip known injection patterns
  │                                 - Unicode homoglyph detection
  │                                 - Invisible character stripping
  │                                 - Max input length enforcement
  ├── output-filter.ts            — Filter LLM outputs before action execution
  │                                 - Detect tool-use in text responses
  │                                 - Block credential leakage in outputs
  │                                 - PII detection and redaction
  ├── guardrails.ts               — Runtime guardrail engine
  │                                 - Action classification (safe/warn/block)
  │                                 - Configurable policy rules
  │                                 - Human-in-the-loop for high-risk actions
  ├── content-boundary.ts         — Mark trust boundaries in message flow
  │                                 - Tag content provenance (user/system/web/skill)
  │                                 - Prevent privilege escalation across boundaries
  └── canary-tokens.ts            — Inject canary tokens to detect exfiltration
```

**Integration points:**

- `src/agents/bash-tools.exec.ts` — Pre-execution guardrail check
- `src/auto-reply/` — Input sanitizer before LLM call
- `src/browser/` — Output filter on browser action results
- `src/security/external-content.ts` — Enhance with trust boundary markers

---

## Phase 2: Identity & Access Management (Weeks 3-6)

### 2.1 Unified IAM System

**Problem:** 7+ scattered permission systems across channels. No unified identity. No enterprise IdP integration.

**New directory structure:**

```
src/enterprise/iam/
  ├── index.ts                    — IAM subsystem initialization
  ├── identity/
  │   ├── provider.ts             — Identity provider interface
  │   ├── local.ts                — Local user database (SQLite)
  │   ├── saml.ts                 — SAML 2.0 SSO (passport-saml)
  │   ├── oidc.ts                 — OpenID Connect (passport-oidc)
  │   ├── oauth2.ts               — OAuth2 provider (generic)
  │   ├── azure-ad.ts             — Azure AD / Entra ID integration
  │   ├── okta.ts                 — Okta integration
  │   ├── ldap.ts                 — LDAP/Active Directory (ldapjs)
  │   └── session.ts              — Session management (JWT + refresh tokens)
  ├── rbac/
  │   ├── model.ts                — RBAC data model (users, roles, permissions, groups)
  │   ├── engine.ts               — Permission evaluation engine
  │   ├── policies.ts             — Default role definitions
  │   ├── middleware.ts           — Express/WS middleware for auth checks
  │   └── admin-api.ts            — CRUD API for user/role management
  ├── agent-identity/
  │   ├── service-accounts.ts     — Agent service accounts (non-human identities)
  │   ├── lifecycle.ts            — Agent identity lifecycle (create/rotate/revoke)
  │   └── audit-binding.ts        — Bind agent actions to identity for audit trail
  └── channel-bridge/
      ├── resolver.ts             — Map channel-specific IDs to unified identity
      ├── discord-mapper.ts       — Discord user → IAM identity
      ├── slack-mapper.ts         — Slack user → IAM identity
      ├── telegram-mapper.ts      — Telegram user → IAM identity
      └── generic-mapper.ts       — Generic channel → IAM identity
```

**Files to modify:**

- `src/gateway/method-scopes.ts` — Replace flat scope model with RBAC permission checks
- `src/gateway/auth.ts` — Add IAM provider resolution before scope assignment
- `src/gateway/server/ws-connection/message-handler.ts` — Inject IAM identity into connection context
- All `extensions/*/src/channel.ts` — Add identity resolver hook

**RBAC Model:**

```typescript
// Roles (built-in, extensible)
const BUILT_IN_ROLES = {
  "super-admin": { permissions: ["*"] },
  admin: { permissions: ["agents.*", "skills.*", "config.*", "users.*", "audit.read"] },
  operator: { permissions: ["agents.run", "agents.list", "sessions.*", "send", "chat.*"] },
  viewer: { permissions: ["agents.list", "sessions.list", "health", "status"] },
  "agent-service": { permissions: ["agent", "send", "tools.*"] },
};

// Permission format: "resource.action" or "resource.*" or "*"
// Examples: "agents.create", "skills.install", "config.write", "audit.read"

// Groups: collection of users sharing roles
// Tenants: isolation boundary (Phase 4)
```

**Integration with existing scopes:**

```
Current:  operator.admin | operator.read | operator.write | operator.approvals | operator.pairing
New:      Maps to RBAC roles: super-admin → operator.admin, operator → operator.write, etc.
          Backwards compatible: old scope strings still work via adapter
```

### 2.2 JWT Authentication

**New files:**

```
src/enterprise/auth/
  ├── jwt.ts                      — JWT creation, validation, refresh
  ├── jwt-keys.ts                 — Key management (RS256, EdDSA)
  ├── token-store.ts              — Token blacklist/revocation (SQLite + optional Redis)
  ├── api-keys.ts                 — Long-lived API key management
  └── auth-middleware.ts          — Unified auth middleware (JWT | API key | device token | legacy)
```

**Auth flow:**

```
1. User authenticates via IdP (SAML/OIDC/LDAP/local)
2. Gateway issues JWT (access token: 15min, refresh token: 7d)
3. All API/WS calls include JWT in Authorization header
4. Gateway validates JWT, extracts identity + roles
5. RBAC engine checks permissions for requested method
6. Audit log records identity + action + result
```

---

## Phase 3: Audit, Compliance & Governance (Weeks 4-7)

### 3.1 Structured Audit Logging

**Problem:** Minimal logging. No tamper-evident audit trail. No compliance support.

**New files:**

```
src/enterprise/audit/
  ├── index.ts                    — Audit subsystem initialization
  ├── logger.ts                   — Structured audit event logger
  ├── schema.ts                   — Audit event schema (Zod-validated)
  ├── storage/
  │   ├── backend.ts              — Storage backend interface
  │   ├── sqlite.ts               — SQLite backend (default, single-node)
  │   ├── postgres.ts             — PostgreSQL backend (multi-node)
  │   ├── s3.ts                   — S3/MinIO archival backend
  │   └── elasticsearch.ts        — Elasticsearch/OpenSearch backend
  ├── integrity.ts                — Tamper-evident chain (hash chaining, Merkle tree)
  ├── query.ts                    — Audit log query API (filters, pagination, export)
  ├── retention.ts                — Configurable retention policies (auto-delete, archive)
  ├── export.ts                   — Export formats (CSV, JSON, SIEM-compatible)
  └── compliance/
      ├── soc2.ts                 — SOC 2 Type II report generation helpers
      ├── hipaa.ts                — HIPAA audit trail requirements
      ├── gdpr.ts                 — GDPR data subject access requests, right to deletion
      └── pci-dss.ts              — PCI DSS logging requirements
```

**Audit event schema:**

```typescript
type AuditEvent = {
  id: string; // ULID (sortable unique ID)
  timestamp: string; // ISO 8601
  version: 1;
  // WHO
  actor: {
    type: "user" | "agent" | "system" | "api-key";
    id: string;
    name?: string;
    ip?: string;
    channel?: string;
    tenantId?: string;
  };
  // WHAT
  action: string; // e.g., "agent.run", "skill.install", "config.update"
  category: "auth" | "agent" | "skill" | "config" | "admin" | "data" | "system";
  // WHERE
  resource: {
    type: string; // e.g., "agent", "skill", "session", "user"
    id: string;
  };
  // RESULT
  outcome: "success" | "failure" | "denied";
  // DETAILS
  metadata: Record<string, unknown>;
  // INTEGRITY
  previousHash?: string; // Hash of previous event (chain)
  hash: string; // SHA-256 of this event
};
```

**Integration points (instrument existing code):**

- `src/gateway/server-methods.ts` — Wrap all RPC method handlers with audit decorator
- `src/agents/bash-tools.exec.ts` — Log all command executions
- `src/agents/skills-install.ts` — Log all skill installations
- `src/config/io.ts` — Log all config changes
- `src/gateway/auth.ts` — Log all auth attempts (success + failure)
- `src/gateway/server/ws-connection/message-handler.ts` — Log all connections

### 3.2 Data Governance

**New files:**

```
src/enterprise/governance/
  ├── data-classification.ts      — Tag data sensitivity levels (public/internal/confidential/restricted)
  ├── dlp.ts                      — Data Loss Prevention rules engine
  ├── pii-detector.ts             — PII detection (regex + ML patterns for SSN, CC, etc.)
  ├── retention-engine.ts         — Data retention policy enforcement
  ├── consent-manager.ts          — GDPR consent tracking
  ├── data-export.ts              — GDPR data subject access request fulfillment
  └── data-deletion.ts            — Right to deletion / data purge
```

---

## Phase 4: Multi-Tenancy & Scalability (Weeks 5-9)

### 4.1 Multi-Tenancy Layer

**Problem:** Single-user architecture. No tenant isolation. All data in one SQLite database.

**New files:**

```
src/enterprise/tenancy/
  ├── index.ts                    — Tenant subsystem initialization
  ├── tenant.ts                   — Tenant data model (id, name, config, limits)
  ├── context.ts                  — Tenant context propagation (AsyncLocalStorage)
  ├── isolation/
  │   ├── data.ts                 — Data isolation (schema-per-tenant or DB-per-tenant)
  │   ├── resource.ts             — Resource isolation (CPU/memory/network quotas)
  │   ├── agent.ts                — Agent isolation (separate sandbox pools)
  │   └── network.ts              — Network isolation (tenant-specific egress rules)
  ├── routing.ts                  — Tenant routing from request context
  ├── provisioning.ts             — Tenant provisioning/deprovisioning
  ├── limits.ts                   — Per-tenant resource limits and quotas
  └── admin-api.ts                — Tenant management API
```

**Tenant context propagation:**

```typescript
// Uses Node.js AsyncLocalStorage for zero-boilerplate tenant context
import { AsyncLocalStorage } from "node:async_hooks";

const tenantStorage = new AsyncLocalStorage<TenantContext>();

type TenantContext = {
  tenantId: string;
  userId: string;
  roles: string[];
  limits: TenantLimits;
};

// All downstream code calls getTenantContext() to get current tenant
export function getTenantContext(): TenantContext {
  const ctx = tenantStorage.getStore();
  if (!ctx) return DEFAULT_TENANT_CONTEXT; // single-user mode fallback
  return ctx;
}
```

**Data isolation strategy:**

```
Single-node:  SQLite database per tenant (~/.openclaw/tenants/<tenantId>/data.db)
Multi-node:   PostgreSQL with schema-per-tenant (tenant_<id>.*)
              OR separate databases per tenant (for regulated environments)
```

### 4.2 Distributed Architecture

**Problem:** Single-node. No horizontal scaling. No fault tolerance.

**New files:**

```
src/enterprise/cluster/
  ├── index.ts                    — Cluster subsystem initialization
  ├── coordinator.ts              — Leader election + coordination (etcd or Redis)
  ├── node-registry.ts            — Cluster node registration and health
  ├── message-bus.ts              — Inter-node message bus (Redis Streams or NATS)
  ├── session-affinity.ts         — Route sessions to correct node
  ├── state-sync.ts               — State synchronization between nodes
  ├── load-balancer.ts            — Internal load balancing for agent execution
  └── failover.ts                 — Automatic failover and recovery
```

**Scaling model:**

```
┌─────────────────────────────────────────────────────────┐
│                    LOAD BALANCER                         │
│              (nginx/envoy/traefik)                       │
└─────────┬──────────────┬──────────────┬─────────────────┘
          │              │              │
    ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐
    │  Gateway  │  │  Gateway  │  │  Gateway  │
    │  Node 1   │  │  Node 2   │  │  Node 3   │
    └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
          │              │              │
    ┌─────▼──────────────▼──────────────▼─────┐
    │          SHARED STATE LAYER              │
    │  ┌──────────┐  ┌───────────┐  ┌───────┐ │
    │  │PostgreSQL│  │   Redis   │  │ S3/   │ │
    │  │(state)   │  │(cache/bus)│  │ MinIO │ │
    │  └──────────┘  └───────────┘  └───────┘ │
    └─────────────────────────────────────────┘
```

**Channel statefulness handling:**

```
Stateful channels (WhatsApp/Baileys, Signal):
  - Pin to single node via coordinator
  - Failover with session handoff
  - Only one node holds Baileys session

Stateless channels (Telegram, Discord, Slack):
  - Any node can handle
  - Load-balanced across cluster
```

### 4.3 Kubernetes Support

**New files:**

```
k8s/
  ├── helm/
  │   └── openclaw/
  │       ├── Chart.yaml
  │       ├── values.yaml              — Default Helm values
  │       ├── values-enterprise.yaml   — Enterprise values overlay
  │       ├── templates/
  │       │   ├── deployment.yaml      — Gateway deployment (HPA-enabled)
  │       │   ├── service.yaml         — ClusterIP + optional LoadBalancer
  │       │   ├── ingress.yaml         — Ingress with TLS termination
  │       │   ├── configmap.yaml       — Config from values
  │       │   ├── secret.yaml          — Secrets (external-secrets compatible)
  │       │   ├── hpa.yaml             — Horizontal Pod Autoscaler
  │       │   ├── pdb.yaml             — Pod Disruption Budget
  │       │   ├── serviceaccount.yaml  — RBAC for pod
  │       │   ├── networkpolicy.yaml   — Network isolation
  │       │   ├── pvc.yaml             — Persistent volume claims
  │       │   ├── cronjob.yaml         — Maintenance jobs (backup, prune)
  │       │   └── _helpers.tpl         — Template helpers
  │       └── README.md
  ├── operator/
  │   ├── api/
  │   │   └── v1alpha1/
  │   │       └── openclaw_types.ts    — CRD type definitions
  │   ├── controllers/
  │   │   └── openclaw_controller.ts   — Reconciliation loop
  │   └── config/
  │       ├── crd/                     — Custom Resource Definitions
  │       ├── rbac/                    — Operator RBAC
  │       └── manager/                 — Operator deployment
  └── examples/
      ├── single-node.yaml            — Minimal single-node deployment
      ├── ha-cluster.yaml             — HA cluster with 3 replicas
      ├── enterprise-full.yaml        — Full enterprise deployment
      └── air-gapped.yaml             — Air-gapped deployment
```

**Helm values structure:**

```yaml
# values.yaml
replicaCount: 1
image:
  repository: ghcr.io/openclaw/openclaw
  tag: latest
  pullPolicy: IfNotPresent

enterprise:
  enabled: false
  multiTenancy: false

gateway:
  bind: loopback
  auth:
    mode: token
  tls:
    enabled: true
    certManager: true # Use cert-manager for auto-certs

persistence:
  enabled: true
  storageClass: ""
  size: 10Gi

postgresql:
  enabled: false # Enable for multi-node
  auth:
    existingSecret: openclaw-db-secret

redis:
  enabled: false # Enable for caching/bus
  auth:
    existingSecret: openclaw-redis-secret

monitoring:
  prometheus:
    enabled: true
    serviceMonitor: true
  grafana:
    enabled: false
    dashboards: true

resources:
  requests:
    cpu: 500m
    memory: 512Mi
  limits:
    cpu: 2000m
    memory: 2Gi

autoscaling:
  enabled: false
  minReplicas: 2
  maxReplicas: 10
  targetCPU: 70
```

---

## Phase 5: Monitoring, Observability & Operations (Weeks 6-8)

### 5.1 Prometheus Metrics

**New files:**

```
src/enterprise/monitoring/
  ├── index.ts                    — Monitoring subsystem init
  ├── metrics.ts                  — Prometheus metrics registry (prom-client)
  ├── metrics-http.ts             — /metrics endpoint handler
  ├── collectors/
  │   ├── gateway.ts              — Gateway metrics (connections, requests, latency)
  │   ├── agent.ts                — Agent metrics (runs, duration, token usage, errors)
  │   ├── skill.ts                — Skill metrics (installs, executions, failures)
  │   ├── channel.ts              — Channel metrics (messages in/out, errors per channel)
  │   ├── sandbox.ts              — Sandbox metrics (container count, resource usage)
  │   ├── auth.ts                 — Auth metrics (attempts, failures, rate limits)
  │   └── system.ts               — System metrics (CPU, memory, disk, Node.js internals)
  ├── alerting/
  │   ├── rules.ts                — Alert rule definitions
  │   └── alertmanager.ts         — Alertmanager webhook integration
  ├── dashboards/
  │   ├── grafana-overview.json   — Grafana dashboard: system overview
  │   ├── grafana-agents.json     — Grafana dashboard: agent performance
  │   ├── grafana-security.json   — Grafana dashboard: security events
  │   └── grafana-costs.json      — Grafana dashboard: LLM cost tracking
  └── health/
      ├── readiness.ts            — Kubernetes readiness probe
      ├── liveness.ts             — Kubernetes liveness probe
      └── startup.ts              — Kubernetes startup probe
```

**Files to modify:**

- `src/gateway/server-http.ts` — Add `/metrics`, `/healthz`, `/readyz`, `/livez` endpoints
- `src/gateway/server.impl.ts` — Initialize metrics collection on startup

**Key metrics:**

```
# Gateway
openclaw_gateway_connections_total{channel}          counter
openclaw_gateway_requests_total{method,status}       counter
openclaw_gateway_request_duration_seconds{method}    histogram

# Agents
openclaw_agent_runs_total{agent_id,model,status}     counter
openclaw_agent_run_duration_seconds{agent_id}         histogram
openclaw_agent_tokens_total{agent_id,direction}       counter
openclaw_agent_cost_usd_total{agent_id,model}         counter

# Skills
openclaw_skill_executions_total{skill,status}         counter
openclaw_skill_installs_total{skill,method}           counter

# Security
openclaw_auth_attempts_total{method,result}           counter
openclaw_sandbox_containers_active{isolation}          gauge
openclaw_audit_events_total{category,action}           counter
```

### 5.2 Backup & Disaster Recovery

**New files:**

```
src/enterprise/backup/
  ├── index.ts                    — Backup subsystem
  ├── snapshot.ts                 — Point-in-time snapshot creation
  ├── restore.ts                  — Snapshot restoration
  ├── schedule.ts                 — Scheduled backup via cron
  ├── storage/
  │   ├── local.ts                — Local filesystem backups
  │   ├── s3.ts                   — S3/MinIO backup target
  │   └── gcs.ts                  — Google Cloud Storage backup target
  └── validation.ts              — Backup integrity verification
```

---

## Phase 6: Skill Supply Chain Security & Marketplace (Weeks 5-8)

### 6.1 Enhanced ClawHub Registry

**Problem:** ~341 malicious/flawed skills in public ClawHub. No code signing. No approval workflow.

**Files to modify:**

- `src/agents/skills-install.ts` — Add signature verification before install
- `src/security/skill-scanner.ts` — Enhance scan rules (more patterns, severity levels)

**New files:**

```
src/enterprise/skills/
  ├── registry/
  │   ├── index.ts                — Enterprise skill registry (self-hosted)
  │   ├── server.ts               — Registry HTTP API server
  │   ├── database.ts             — Skill metadata database (PostgreSQL/SQLite)
  │   ├── storage.ts              — Skill artifact storage (S3/local)
  │   ├── approval-workflow.ts    — Skill submission → review → approve/reject
  │   ├── code-signing.ts         — Ed25519 code signing for skills
  │   ├── signature-verify.ts     — Verify skill signatures before installation
  │   └── sync.ts                 — Sync approved skills from public ClawHub
  ├── scanning/
  │   ├── sast.ts                 — Static analysis (enhanced patterns, semgrep integration)
  │   ├── dast.ts                 — Dynamic analysis (sandboxed execution + behavior monitoring)
  │   ├── dependency-audit.ts     — npm audit / snyk integration for skill dependencies
  │   ├── malware-scan.ts         — ClamAV / YARA rule scanning
  │   └── license-check.ts        — License compliance checking
  └── sandboxing/
      ├── skill-sandbox.ts        — Per-skill sandbox enforcement
      ├── capabilities.ts         — Skill capability declarations (network, filesystem, etc.)
      └── resource-limits.ts      — Per-skill resource limits
```

### 6.2 Marketplace API & UI

**New files:**

```
src/marketplace/
  ├── api/
  │   ├── index.ts                — Marketplace REST API router
  │   ├── browse.ts               — Browse/search skills (paginated, filtered)
  │   ├── detail.ts               — Skill detail page data
  │   ├── install.ts              — One-click install endpoint
  │   ├── publish.ts              — Publish skill endpoint
  │   ├── rate.ts                 — Rate/review skills
  │   ├── stats.ts                — Download stats, trending
  │   └── author.ts               — Author profiles
  └── ui/
      ├── marketplace-page.ts     — Lit component: marketplace browse/search
      ├── skill-card.ts           — Lit component: skill card (name, rating, install button)
      ├── skill-detail.ts         — Lit component: skill detail view
      ├── publish-form.ts         — Lit component: publish skill form
      └── review-list.ts          — Lit component: reviews/ratings
```

**Files to modify:**

- `ui/src/ui/controllers/skill-controller.ts` — Add marketplace data fetching
- `ui/src/main.ts` — Add marketplace route

---

## Phase 7: Viral Features & Developer Experience (Weeks 4-8)

### 7.1 One-Command Install & Auto-Demo

**New files:**

```
scripts/
  ├── install.sh                  — curl | bash one-liner installer
  │                                 - Detect OS/arch
  │                                 - Install Node.js if missing (via nvm/fnm)
  │                                 - npm install -g openclaw
  │                                 - Run openclaw onboard --quick
  │                                 - Optionally run demo
  └── install.ps1                 — PowerShell installer for Windows

src/demos/
  ├── index.ts                    — Demo runner framework
  ├── showcase.ts                 — Showcase task chain (creates impressive demo)
  ├── scenarios/
  │   ├── github-pr.ts            — Auto-create GitHub PR demo
  │   ├── slack-summary.ts        — Slack channel summary demo
  │   ├── code-review.ts          — Code review demo
  │   ├── multi-agent.ts          — Multi-agent orchestration demo
  │   └── browser-task.ts         — Browser automation demo
  ├── capture/
  │   ├── gif-recorder.ts         — Record demo as GIF (using Playwright)
  │   ├── screenshot.ts           — Capture screenshots
  │   └── video.ts                — Record demo video
  └── export/
      ├── markdown-report.ts      — Export as Markdown
      ├── tweet-card.ts           — Generate tweet-ready image
      └── share-link.ts           — Generate shareable demo link
```

**Install one-liners:**

```bash
# npm (recommended)
npm install -g openclaw && openclaw onboard

# curl | bash (includes Node.js setup)
curl -fsSL https://get.openclaw.dev | bash

# Docker (zero-install)
docker run -it --rm -v ~/.openclaw:/home/node/.openclaw ghcr.io/openclaw/openclaw onboard

# Podman
podman run -it --rm -v ~/.openclaw:/home/node/.openclaw ghcr.io/openclaw/openclaw onboard
```

**Auto-demo on first run:**

```bash
openclaw onboard --demo
# 1. Sets up with local model (Ollama) or API key
# 2. Runs impressive task chain:
#    - Creates a sample project
#    - Writes code, commits, creates PR
#    - Summarizes a webpage
#    - Sends result to chosen channel
# 3. Captures GIF/screenshot of the process
# 4. Outputs: "Share your demo: openclaw share --last"
```

### 7.2 VS Code Extension

**New files:**

```
extensions/vscode/
  ├── package.json                — Extension manifest
  ├── src/
  │   ├── extension.ts            — Extension entry point
  │   ├── sidebar.ts              — Sidebar panel (chat with agent)
  │   ├── commands.ts             — VS Code commands (run agent, install skill)
  │   ├── gateway-client.ts       — WebSocket client to local gateway
  │   ├── diagnostics.ts          — Show agent diagnostics in editor
  │   ├── code-actions.ts         — Agent-powered code actions (fix, explain, test)
  │   └── status-bar.ts           — Status bar indicator (connected/disconnected)
  ├── webview/
  │   ├── chat.html               — Chat webview
  │   └── chat.ts                 — Chat webview logic
  ├── README.md
  └── tsconfig.json
```

### 7.3 GitHub Actions Integration

**New files:**

```
actions/
  └── openclaw-action/
      ├── action.yml               — GitHub Action definition
      ├── src/
      │   ├── main.ts              — Action entry point
      │   ├── agent-runner.ts      — Run OpenClaw agent in CI
      │   └── pr-reviewer.ts       — Auto-review PRs
      ├── README.md
      └── package.json
```

### 7.4 Enhanced CLI

**Files to modify:**

- `src/cli/program.js` — Add new commands

**New CLI commands:**

```bash
openclaw demo                    # Run interactive demo
openclaw share                   # Share last demo as GIF/link
openclaw marketplace             # Browse marketplace (TUI)
openclaw security audit          # Run security audit (enhanced)
openclaw security audit --deep   # Deep security audit with live gateway probe
openclaw enterprise init         # Initialize enterprise features
openclaw enterprise dashboard    # Open admin dashboard
openclaw cluster status          # Show cluster health
openclaw backup create           # Create backup
openclaw backup restore          # Restore from backup
openclaw tenant create           # Create tenant
openclaw tenant list             # List tenants
openclaw metrics                 # Show current metrics
```

---

## Phase 8: Admin Dashboard (Weeks 7-10)

### 8.1 Enterprise Admin UI

**New files:**

```
ui/src/ui/admin/
  ├── admin-app.ts                — Admin dashboard root component
  ├── pages/
  │   ├── dashboard.ts            — Overview dashboard (metrics, alerts, status)
  │   ├── users.ts                — User management (CRUD, roles, groups)
  │   ├── agents.ts               — Agent management (config, status, logs)
  │   ├── skills.ts               — Skill management (install, approve, scan)
  │   ├── tenants.ts              — Tenant management (create, configure, limits)
  │   ├── audit.ts                — Audit log viewer (search, filter, export)
  │   ├── security.ts             — Security dashboard (findings, compliance, posture)
  │   ├── config.ts               — Configuration management
  │   ├── monitoring.ts           — Monitoring dashboard (embedded Grafana or custom charts)
  │   └── backups.ts              — Backup management
  ├── components/
  │   ├── data-table.ts           — Reusable data table with sorting/filtering
  │   ├── metric-card.ts          — Metric display card
  │   ├── chart.ts                — Simple chart component (sparkline, bar, pie)
  │   ├── log-viewer.ts           — Log stream viewer
  │   └── form-builder.ts         — Dynamic form generation from schema
  └── controllers/
      ├── admin-controller.ts     — Admin API client
      └── metrics-controller.ts   — Metrics data fetching
```

---

## Phase 9: CI/CD, Testing & Documentation (Weeks 8-10)

### 9.1 Enhanced CI/CD

**Files to modify:**

- `.github/workflows/ci.yml` — Add enterprise test jobs

**New files:**

```
.github/workflows/
  ├── security-scan.yml           — SAST/DAST/dependency scanning
  ├── enterprise-e2e.yml          — Enterprise feature E2E tests
  └── release-enterprise.yml      — Enterprise release pipeline

test/enterprise/
  ├── iam.e2e.test.ts             — IAM integration tests
  ├── rbac.test.ts                — RBAC unit tests
  ├── audit.test.ts               — Audit logging tests
  ├── secrets.test.ts             — Secret management tests
  ├── sandbox-isolation.e2e.test.ts — Sandbox isolation E2E
  ├── multi-tenancy.e2e.test.ts   — Multi-tenancy E2E
  └── cluster.e2e.test.ts         — Cluster E2E tests
```

### 9.2 Documentation

**Files to modify:**

- `README.md` — Complete rewrite with viral hooks + enterprise sections

**New files:**

```
docs/
  ├── enterprise/
  │   ├── quick-start.md          — Enterprise quick start (5 min)
  │   ├── architecture.md         — Enterprise architecture overview
  │   ├── security.md             — Security hardening guide
  │   ├── iam.md                  — IAM/RBAC configuration
  │   ├── compliance.md           — Compliance guide (SOC 2, HIPAA, GDPR)
  │   ├── kubernetes.md           — Kubernetes deployment guide
  │   ├── monitoring.md           — Monitoring & alerting setup
  │   ├── backup.md               — Backup & disaster recovery
  │   ├── multi-tenancy.md        — Multi-tenancy configuration
  │   └── migration.md            — Migration from community to enterprise config
  ├── api/
  │   ├── rest-api.md             — REST API reference
  │   ├── websocket-api.md        — WebSocket API reference
  │   └── plugin-sdk.md           — Plugin SDK reference
  └── guides/
      ├── first-skill.md          — Build your first skill (5 min)
      ├── custom-channel.md       — Build a custom channel
      └── contributing.md         — Contribution guide
```

---

## Implementation Priority & Dependencies

```
Week 1-2:  Phase 1.1 (Gateway Hardening) + Phase 1.2 (Secrets) — NO DEPENDENCIES
Week 2-3:  Phase 1.3 (Sandbox) + Phase 1.4 (Prompt Injection) — depends on 1.1
Week 3-5:  Phase 2 (IAM/RBAC) — depends on 1.1, 1.2
Week 4-6:  Phase 3 (Audit/Compliance) — depends on 2
Week 4-6:  Phase 7.1 (Viral Install/Demo) — NO DEPENDENCIES (parallel track)
Week 5-7:  Phase 6 (Skill Supply Chain) — depends on 1.3
Week 5-8:  Phase 4 (Multi-Tenancy/Scale) — depends on 2, 3
Week 6-8:  Phase 5 (Monitoring) — depends on 4
Week 7-9:  Phase 7.2-7.4 (VS Code, GitHub Actions, CLI) — depends on 7.1
Week 7-10: Phase 8 (Admin Dashboard) — depends on 2, 3, 5
Week 8-10: Phase 9 (CI/CD, Docs) — depends on all

PARALLEL TRACKS:
  Track A (Security): 1.1 → 1.2 → 1.3 → 1.4 → 6
  Track B (Identity): 2 → 3 → 8
  Track C (Scale):    4 → 5
  Track D (Viral):    7.1 → 7.2 → 7.3 → 7.4
  Track E (Quality):  9 (continuous)
```

---

## Backwards Compatibility Strategy

**ALL enterprise features are opt-in.** The default experience remains identical to current OpenClaw:

```yaml
# Default config (unchanged behavior):
# - Single user, local SQLite, loopback gateway, token auth
# - No enterprise features active
# - Zero performance overhead from enterprise code (lazy-loaded)

# Enterprise activation:
enterprise:
  enabled: true # Activates enterprise subsystems
  # Each subsystem is independently configurable
  iam:
    enabled: true
    provider: "local" # local | saml | oidc | ldap
  audit:
    enabled: true
    storage: "sqlite" # sqlite | postgres | elasticsearch
  tenancy:
    enabled: false # Only when needed
  cluster:
    enabled: false # Only for multi-node
  monitoring:
    enabled: true
    prometheus: true
```

**Lazy loading strategy:**

```typescript
// Enterprise modules are lazy-loaded to avoid overhead in community mode
export async function initEnterprise(config: OpenClawConfig) {
  if (!config.enterprise?.enabled) return;

  // Dynamic imports — zero cost if not enabled
  const { initIAM } = await import("./enterprise/iam/index.js");
  const { initAudit } = await import("./enterprise/audit/index.js");
  const { initMonitoring } = await import("./enterprise/monitoring/index.js");

  if (config.enterprise.iam?.enabled) await initIAM(config);
  if (config.enterprise.audit?.enabled) await initAudit(config);
  if (config.enterprise.monitoring?.enabled) await initMonitoring(config);
}
```

---

## New Directory Structure Summary

```
C:/Projects/openclawenterprise/
├── src/
│   ├── enterprise/                    ← NEW: All enterprise features
│   │   ├── index.ts
│   │   ├── secrets/                   ← Secret management
│   │   ├── sandbox/                   ← Enhanced sandboxing
│   │   ├── security/                  ← Prompt injection, guardrails
│   │   ├── iam/                       ← Identity & access management
│   │   ├── auth/                      ← JWT, API keys
│   │   ├── audit/                     ← Audit logging & compliance
│   │   ├── governance/                ← Data governance & DLP
│   │   ├── tenancy/                   ← Multi-tenancy
│   │   ├── cluster/                   ← Distributed architecture
│   │   ├── monitoring/                ← Prometheus, health probes
│   │   ├── backup/                    ← Backup & disaster recovery
│   │   └── skills/                    ← Skill supply chain security
│   ├── marketplace/                   ← NEW: Marketplace API
│   ├── demos/                         ← NEW: Demo framework
│   ├── [existing src/ directories]    ← UNCHANGED (modified in-place)
│
├── k8s/                               ← NEW: Kubernetes support
│   ├── helm/openclaw/
│   └── operator/
│
├── extensions/
│   ├── vscode/                        ← NEW: VS Code extension
│   └── [existing extensions]          ← UNCHANGED
│
├── actions/                           ← NEW: GitHub Actions
│   └── openclaw-action/
│
├── ui/src/ui/admin/                   ← NEW: Admin dashboard
│
├── test/enterprise/                   ← NEW: Enterprise tests
│
├── docs/enterprise/                   ← NEW: Enterprise docs
│
├── scripts/
│   ├── install.sh                     ← NEW: One-liner installer
│   └── install.ps1                    ← NEW: Windows installer
│
└── [existing root files]              ← MODIFIED: README.md, Dockerfile, etc.
```

---

## Key Technical Decisions

1. **Database:** SQLite (single-node default) + PostgreSQL (multi-node opt-in) + Redis (caching/pub-sub)
2. **Auth:** JWT (RS256) with refresh tokens. Backwards-compatible with existing token/password auth
3. **Secrets:** AES-256-GCM with Argon2id key derivation. OS keychain for master key storage
4. **Sandbox:** Docker-based (existing) enhanced with gVisor runtime, seccomp, AppArmor
5. **Audit:** Hash-chained structured events. SQLite default, PostgreSQL/Elasticsearch for scale
6. **Metrics:** prom-client for Prometheus. Zero overhead when disabled
7. **Cluster:** Redis Streams for inter-node messaging. etcd for leader election (optional)
8. **K8s:** Helm chart first, operator second. cert-manager integration
9. **UI:** Lit web components (consistent with existing ui/). Admin dashboard extends control UI
10. **Testing:** Vitest (existing). Enterprise tests in separate config. Docker-based E2E

---

## Deployment Guide Outline

### Local Development (Individual)

```bash
npm install -g openclaw
openclaw onboard
# That's it. Running on localhost:18789
```

### Docker (Team)

```bash
docker compose up -d
# Set OPENCLAW_GATEWAY_TOKEN in .env
# Configure channels via openclaw config
```

### Kubernetes (Enterprise)

```bash
helm repo add openclaw https://charts.openclaw.dev
helm install openclaw openclaw/openclaw \
  --set enterprise.enabled=true \
  --set enterprise.iam.provider=oidc \
  --set enterprise.iam.oidc.issuer=https://auth.company.com \
  --set postgresql.enabled=true \
  --set redis.enabled=true \
  --set monitoring.prometheus.enabled=true \
  --values my-values.yaml
```

### Enterprise HA Cluster

```bash
helm install openclaw openclaw/openclaw \
  --set replicaCount=3 \
  --set enterprise.enabled=true \
  --set enterprise.cluster.enabled=true \
  --set enterprise.tenancy.enabled=true \
  --set autoscaling.enabled=true \
  --set autoscaling.minReplicas=3 \
  --set autoscaling.maxReplicas=20 \
  --values enterprise-ha.yaml
```
