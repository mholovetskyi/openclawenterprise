# Security hardening guide

This document covers the security defaults and hardening options available in OpenClaw.

## Gateway binding (zero-trust by default)

OpenClaw's gateway **never silently binds to `0.0.0.0`**. The default is `loopback` — the gateway is only reachable from the local machine.

```yaml
gateway:
  bind: loopback # default — only 127.0.0.1
  # bind: lan       # WARNING: exposes to all network interfaces
  # bind: tailnet   # Tailscale IP only (recommended for remote access)
  # bind: custom
  #   host: 10.0.0.5
```

When `bind: lan` or any non-loopback config is detected, OpenClaw emits a prominent warning to stderr and (in enterprise mode) the startup log. **You must acknowledge the warning to proceed.**

## Auth modes

| Mode       | When to use                                               |
| ---------- | --------------------------------------------------------- |
| `none`     | Local loopback only — acceptable for personal use         |
| `token`    | Static bearer token — simple shared secret                |
| `password` | Password auth — required for Funnel                       |
| `jwt`      | Enterprise JWT (RS256/HS256) — recommended for multi-user |

> **Never use `auth.mode: none` with a non-loopback bind.** OpenClaw will warn loudly if this is detected.

## Secrets encryption

Enterprise mode replaces all plaintext credential files with AES-256-GCM encrypted storage.

```yaml
enterprise:
  secrets:
    backend: file # encrypted local file (default enterprise)
    # backend: vault    # HashiCorp Vault
    # backend: aws-sm   # AWS Secrets Manager
    # backend: gcp-sm   # GCP Secret Manager
    # backend: azure-kv # Azure Key Vault
```

The master key is stored in the OS keychain (macOS Keychain / Windows DPAPI). On Linux it falls back to `~/.openclaw/.master-key` (mode `0600`).

**Legacy credential migration:** on first enterprise start, `~/.openclaw/credentials` is automatically encrypted and migrated. The original is renamed to `.migrated` (not deleted) so you can verify before removal.

## Prompt injection defenses

All external content (channel messages, webhook payloads, tool results) passes through:

1. **Unicode normalization** (NFC) + invisible character stripping
2. **Injection pattern detection** — rejects/warns on "ignore previous instructions", DAN attempts, system override phrases
3. **Trust boundary tagging** — external content is wrapped with `<EXTERNAL CONTENT source="...">` to prevent the model from treating it as system instructions
4. **Truncation** at configurable max length (default 32 KB)

## Runtime guardrails

The guardrail engine evaluates every tool invocation against a rule set:

| Rule                                                  | Action             |
| ----------------------------------------------------- | ------------------ |
| Credential harvest (reading `~/.ssh`, `~/.aws`, etc.) | `require-approval` |
| Reverse shell patterns                                | `block`            |
| Mass delete (`rm -rf /`, `DROP TABLE`)                | `require-approval` |
| SSN pattern in output                                 | `warn`             |
| Credit card number in output                          | `warn`             |

Custom rules can be added via `enterprise.guardrails.rules` in config.

## Skill supply chain security

> **Not yet enforced at skill install.** The signing and SAST primitives below
> ship and are unit-tested, but the skill-install path does **not** yet call
> them: `enterprise.skills.requireSigning` / `requireSast` gate nothing at
> install time. To avoid giving false assurance, setting either flag currently
> makes the gateway **refuse to boot** (fail closed) — see the startup
> enforcement guard in `src/enterprise/index.ts`. Treat skill signing/SAST as
> experimental (library-only) until the install-time gate is wired.
>
> Enterprise **plugins** are different: plugins loaded through the enterprise
> `PluginLoader` (`src/enterprise/plugins/loader.ts`) **are** Ed25519
> signature-verified before their code is imported when `requireSigning` is set,
> failing closed on a missing, malformed, tampered, or untrusted signature.

### Code signing (library API)

The signing primitives verify a skill directory against a trusted Ed25519 key.
They are invoked programmatically today (and by the enterprise plugin loader),
not by the skill-install path:

```yaml
# Configured, but NOT enforced at skill install — enabling this refuses to boot.
enterprise:
  skills:
    requireSigning: true
    trustedKeys:
      - base64pubkey1==
      - base64pubkey2==
```

Generate a signing key pair:

```typescript
import { generateSigningKeyPair } from "./src/enterprise/skills/registry/code-signing.js";
const { publicKey, privateKey } = generateSigningKeyPair();
```

### Enterprise SAST (library API)

The SAST scanner (`runEnterpriseScan`) is available as a library call but is
**not** run automatically before a skill is installed in this build. When
invoked, it checks for:

- Credential harvest (reading SSH keys, token files)
- Reverse shell patterns
- Persistence mechanisms (crontab, launchd, systemd)
- Code injection (eval, Function constructor)
- Prototype pollution
- Dangerous deserialization
- Path traversal
- Supply chain red flags (dynamic require, obfuscated code)
- Sensitive data exfiltration (curl to external IPs)

Each finding is tagged with CWE IDs and OWASP Top 10 categories. When run, the
scanner classifies skills scoring >70 risk points as **reject**, 40–70 as
**review**, and <40 as **approve** — but note (see the callout above) that no
install-time path currently consults this recommendation.

## Recommended production checklist

- [ ] `gateway.bind: loopback` (or `tailnet` for remote access)
- [ ] `gateway.auth.mode: jwt` (not `none`)
- [ ] `enterprise.secrets.backend: vault` (or cloud equivalent)
- [ ] TLS termination at the ingress layer (not the gateway itself)
- [ ] Firewall rules restricting gateway port to authorized IPs
- [ ] `enterprise.audit.enabled: true` for SOC 2 / HIPAA compliance
- [ ] `enterprise.iam.enabled: true` with role assignments
- [ ] Regular review of `~/.openclaw/audit.db`
- [ ] Enterprise plugins signed (Ed25519) and loaded through the enterprise `PluginLoader` with `requireSigning`
- [ ] Skill-install signing/SAST: **not yet enforced** — leave `enterprise.skills.requireSigning` / `requireSast` unset (enabling them refuses to boot)
