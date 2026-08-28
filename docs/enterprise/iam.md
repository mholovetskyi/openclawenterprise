# IAM & RBAC

OpenClaw enterprise ships a full identity and access management system with role-based access control, JWT authentication, and API key support.

## Enabling IAM

```yaml
enterprise:
  enabled: true
  iam:
    enabled: true
    jwt:
      algorithm: RS256 # RS256 (default, auto-generates key pair) or HS256
      expiresIn: 15m # access token TTL
      refreshExpiresIn: 7d
```

On first start, if `algorithm: RS256` is configured, OpenClaw auto-generates an RSA key pair and stores it at:

- `~/.openclaw/enterprise/iam/private.pem`
- `~/.openclaw/enterprise/iam/public.pem`

## Built-in roles

These are the authoritative built-in role permission sets (see
`src/enterprise/iam/rbac/model.ts`, `BUILT_IN_ROLES`):

| Role            | Permissions                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `super-admin`   | `*` (everything)                                                                                                                                                         |
| `admin`         | `agents.*`, `skills.*`, `config.*`, `users.*`, `groups.*`, `sessions.*`, `channels.*`, `audit.read`, `health.*`, `cron.*`, `node.*` — includes user and group management |
| `operator`      | `agents.list`, `agents.run`, `sessions.*`, `send`, `chat.*`, `tts.*`, `health.read`, `status.read`, `node.invoke` — no `config`, `skills`, or `channels`                 |
| `viewer`        | `agents.list`, `sessions.list`, `sessions.preview`, `health.read`, `status.read`, `models.list`, `skills.status` — read-only                                             |
| `agent-service` | `agent`, `send`, `tools.*`, `sessions.read`, `skills.status` — non-human agent identity                                                                                  |

> There is **no `roles.*` permission**. Role management is authorized through
> `groups.*` (roles are assigned to users via groups), so only `admin` /
> `super-admin` — which hold `groups.*` / `*` — can manage roles.

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
- `channels` — manage channel connections (admin+)
- `skills` — install/remove/invoke skills (admin+; `viewer`/`agent-service` hold only `skills.status`)
- `config` — read/write gateway configuration (admin+)
- `users` — manage users (admin+)
- `groups` — manage groups; role assignment is authorized here (admin+). There is no `roles.*` permission.
- `audit` — read audit log via `audit.read` (admin+; `operator` does **not** have it)
- `sessions` — view/manage sessions

## Backwards compatibility

Legacy `operator.*` scope tokens continue to work. They are automatically mapped to the RBAC `operator` role permissions via the compatibility adapter.

## OIDC / SAML

An OpenID Connect module ships in this build (`src/enterprise/auth/oidc.ts`:
`OidcService`, `createOidcHandlers`, `initOidc`) with PKCE, JWKS ID-token
verification, and IdP-group-to-role mapping. **However, it is not wired as a
login flow in this build:** `initEnterprise` never calls `initOidc`, so no
`/auth/oidc/login` or `/auth/oidc/callback` endpoints are registered and setting
`enterprise.iam.oidc` / `enterprise.auth.oidc` in config does **not** activate
OIDC authentication (the gateway warns at boot when either is enabled). Use the
module programmatically until the login flow is wired.

SAML is not implemented. The IAM architecture is designed to support pluggable
auth providers via the `initIAM()` extension points.
