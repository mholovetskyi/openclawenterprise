# IAM & RBAC

OpenClaw enterprise ships a full identity and access management system with role-based access control, JWT authentication, and API key support.

## Enabling IAM

```yaml
enterprise:
  enabled: true
  iam:
    enabled: true
    jwt:
      algorithm: RS256    # RS256 (default, auto-generates key pair) or HS256
      expiresIn: 15m      # access token TTL
      refreshExpiresIn: 7d
```

On first start, if `algorithm: RS256` is configured, OpenClaw auto-generates an RSA key pair and stores it at:
- `~/.openclaw/enterprise/iam/private.pem`
- `~/.openclaw/enterprise/iam/public.pem`

## Built-in roles

| Role | Permissions |
|------|-------------|
| `super-admin` | `*` (everything) |
| `admin` | All except user/role management |
| `operator` | Agents, skills, channels — no config write |
| `viewer` | Read-only on all resources |
| `agent-service` | Scoped to agent execution only |

## API keys

API keys are generated in the format `oc_<base64url-random>`. Only the SHA-256 hash is stored.

```typescript
import { generateApiKey } from "./src/enterprise/auth/jwt.js";
const { key, hash } = generateApiKey("oc");
// key: "oc_xyz..." — show once, never stored
// hash: stored in the IAM database
```

## Permission model

Permissions use dot-notation with wildcard support:

```
agents.run          # exact permission
agents.*            # all agents permissions
*                   # all permissions (super-admin only)
```

### Resource types

- `agents` — start/stop/configure agents
- `channels` — manage channel connections
- `skills` — install/remove/invoke skills
- `config` — read/write gateway configuration
- `users` — manage users (admin+)
- `roles` — manage RBAC roles (admin+)
- `audit` — read audit log (operator+)
- `metrics` — read Prometheus metrics (viewer+)
- `sessions` — view/manage sessions

## Backwards compatibility

Legacy `operator.*` scope tokens continue to work. They are automatically mapped to the RBAC `operator` role permissions via the compatibility adapter.

## OIDC / SAML (roadmap)

External identity provider integration (Okta, Azure AD, Google Workspace, LDAP) is on the roadmap. The IAM architecture is designed to support pluggable auth providers via the `initIAM()` extension points.
