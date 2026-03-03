# Audit logging & compliance

OpenClaw enterprise provides tamper-evident structured audit logging suitable for SOC 2, HIPAA, and GDPR compliance requirements.

## Overview

Every significant action — authentication, agent execution, skill invocation, config changes, guardrail blocks — is recorded as an audit event with:

- **ULID** — lexicographically sortable, millisecond-precision ID
- **SHA-256 hash chain** — each event includes `previousHash`, making tampering detectable
- **Actor** — user ID, agent ID, or system
- **Resource** — what was affected
- **Outcome** — `success` | `failure` | `blocked`
- **IP address** — for gateway requests
- **Tenant ID** — for multi-tenant deployments

## Enabling

```yaml
enterprise:
  enabled: true
  audit:
    enabled: true
    storage:
      driver: sqlite # sqlite (default) | postgresql (roadmap)
      path: ~/.openclaw/audit.db
    retention:
      days: 365 # auto-purge events older than N days
```

## Hash chain verification

To verify the audit log hasn't been tampered with:

```typescript
import { createSQLiteAuditStorage } from "./src/enterprise/audit/storage/sqlite.js";
import { verifyChain } from "./src/enterprise/audit/schema.js";

const storage = createSQLiteAuditStorage("~/.openclaw/audit.db");
const events = await storage.query({ limit: 10000 });
const result = verifyChain(events);

if (!result.valid) {
  console.error(`Chain break detected at event ${result.brokenAt}`);
}
```

## Well-known audit actions

| Action               | Description                   |
| -------------------- | ----------------------------- |
| `auth.login`         | Successful authentication     |
| `auth.logout`        | Session terminated            |
| `auth.failed`        | Authentication failure        |
| `agent.run.start`    | Agent task started            |
| `agent.run.complete` | Agent task completed          |
| `agent.run.error`    | Agent task errored            |
| `skill.install`      | Skill installed               |
| `skill.invoke`       | Skill invoked                 |
| `skill.blocked`      | Skill blocked by SAST/signing |
| `guardrail.warn`     | Guardrail warning emitted     |
| `guardrail.block`    | Action blocked by guardrail   |
| `config.read`        | Config accessed               |
| `config.write`       | Config modified               |
| `user.create`        | IAM user created              |
| `user.delete`        | IAM user deleted              |
| `role.assign`        | Role assigned to user         |

## Compliance use cases

### SOC 2

Audit logs satisfy the SOC 2 CC6 (logical and physical access controls) and CC7 (system operations) criteria. Ensure `retention.days >= 365`.

### HIPAA

For HIPAA-covered workloads, set `retention.days: 2555` (7 years) and ensure audit DB backups. Log all `agent.run.*` events, as the agent may process PHI.

### GDPR

The `actor` field in audit events may contain personal data (user IDs). Implement a data deletion procedure that anonymizes audit records on user deletion requests. The hash chain allows replacing personal data with `[REDACTED]` while preserving chain integrity — use `sha256(REDACTED)` as the replacement hash.
