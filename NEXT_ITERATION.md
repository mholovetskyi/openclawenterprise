# OpenClaw Enterprise — Next Iteration Plan

> Generated: 2026-02-23
> Branch: `claude/fix-security-warnings-MKeCv`
> Prior work this iteration: Fixed all 208 oxlint security/correctness warnings across 45 files.

---

## What Was Completed This Iteration

All security-related lint warnings have been resolved (0 errors, 0 warnings):

| Category                                             | Count Fixed | Files                                            |
| ---------------------------------------------------- | ----------- | ------------------------------------------------ |
| `curly` missing braces on if/else                    | 138         | Enterprise security, auth, secrets, IAM, gateway |
| `no-unnecessary-type-assertion`                      | 33          | `oidc.ts`, `mfa.ts`, `postgres.ts`               |
| `unbound-method` in tests                            | 4           | `logger.test.ts`                                 |
| `no-array-sort` / `no-array-reverse`                 | 5           | Various                                          |
| `no-useless-constructor`                             | 4           | Various                                          |
| `restrict-template-expressions` unknown in template  | 2           | `logger.ts`, `oidc.ts`                           |
| `no-redundant-type-constituents`                     | 2           | `metrics.ts`, `backend-aws-sm.ts`                |
| `no-unused-expressions`                              | 2           | `metrics.ts`                                     |
| `no-control-regex` / `no-misleading-character-class` | 2           | `input-sanitizer.ts` (intentional, suppressed)   |
| `no-unused-vars` (imports, params, functions)        | 16          | Multiple files                                   |

---

## Next Iteration: Priority Ordered

### Priority 1 — Security: Pin GitHub Actions to SHA Digests

**Status:** `zizmor.yml` has `unpinned-uses: disable: true` — pinning deferred.
**Risk:** Supply-chain compromise via mutable tags (e.g., `actions/checkout@v4` can be poisoned).

**Actions:**

- Pin every `uses:` step in all `.github/workflows/*.yml` to a full SHA digest.
- Re-enable `unpinned-uses` rule in `zizmor.yml` once pinned.
- Add `dependabot.yml` entry for `github-actions` ecosystem to keep SHAs current automatically (already present — verify it covers all workflows).

**Example:**

```yaml
# Before
- uses: actions/checkout@v4
# After
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
```

---

### Priority 2 — Security: Re-enable Zizmor Rules

**Status:** `excessive-permissions` and `artipacked` are disabled in `zizmor.yml`.

**Actions:**

- Audit every workflow for minimum-privilege `permissions:` blocks. Add explicit job-level permissions instead of workflow-level where possible.
- Remove `persist-credentials: true` (or make it explicit with justification) to resolve `artipacked` findings.
- Re-enable rules in `zizmor.yml` once workflow permissions are tightened:
  ```yaml
  excessive-permissions:
    disable: false
  artipacked:
    disable: false
  ```

---

### Priority 3 — Security: Add Container Vulnerability Scan to CI

**Status:** `container.yml` signs images with cosign and generates SBOMs, but there is no Trivy/Grype scan uploaded as SARIF to GitHub Security tab.
The `security-scan.yml` workflow is missing a container/image scan step.

**Actions:**

- Add Trivy scan step to `security-scan.yml` (or `container.yml`) that:
  - Scans the built image for OS CVEs and language-level vulns.
  - Uploads results as SARIF to GitHub Security code scanning.
  - Fails the build on `CRITICAL` severity.
- Add `trivy config` scan for IaC (Dockerfile, k8s manifests, Helm).

```yaml
- name: Trivy image scan
  uses: aquasecurity/trivy-action@v0.20.0
  with:
    image-ref: ${{ steps.meta.outputs.tags }}
    format: sarif
    output: trivy-results.sarif
    severity: CRITICAL,HIGH
    exit-code: "1"

- name: Upload Trivy SARIF
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: trivy-results.sarif
```

---

### Priority 4 — Enterprise Feature Wiring: OIDC State Store → Redis

**Status:** `src/enterprise/auth/oidc.ts:211` comment: _"In production this should be Redis-backed for multi-node. For single-node the in-process Map is sufficient."_

The `pendingLogins` Map is in-process, meaning OIDC OAuth flows break across multi-node deployments (no session affinity).

**Actions:**

- Create `src/enterprise/auth/oidc-state-store.ts` with interface:
  ```typescript
  interface OIDCStateStore {
    set(state: string, data: PendingLogin, ttlMs: number): Promise<void>;
    get(state: string): Promise<PendingLogin | undefined>;
    delete(state: string): Promise<void>;
  }
  ```
- Implement `InMemoryOIDCStateStore` (existing behavior, for single-node).
- Implement `RedisOIDCStateStore` using the existing Redis cluster infrastructure in `src/enterprise/cluster/`.
- Wire via `createOIDCService()` factory based on `config.enterprise.oidc.stateStore`.

---

### Priority 5 — Enterprise Feature Wiring: Trust Boundary in Chat Handler

**Status:** `wrapWithTrustBoundary` was imported (but unused) in `src/gateway/server-methods/chat.ts` — the import was cleaned up this iteration. The function exists and is exported from `input-sanitizer.ts`, but external/web content passed to the LLM in the chat pipeline is not being wrapped with trust-boundary markers.

**Actions:**

- Audit the chat pipeline for content sources that originate from external input (web fetch results, skill outputs, document attachments).
- Wrap those content segments with `wrapWithTrustBoundary(content, source, "web" | "skill")` before they enter the LLM context window.
- Add a test asserting that web-fetched content in prompts carries trust-boundary markers.

---

### Priority 6 — Re-enable Dead Code CI Job

**Status:** `ci.yml` dead-code job has `if: false` — intentionally disabled while initial findings are processed.

**Actions:**

- Triage `knip`, `ts-prune`, and `ts-unused-exports` reports from artifacts.
- Remove or export the identified dead symbols.
- Re-enable the job gate (change `if: false` to a proper condition).
- Optionally make it a non-blocking advisory job (warn, don't fail) as a first step.

---

### Priority 7 — TypeScript: Enable Stricter `tsconfig` Options

**Status:** `tsconfig.json` does not yet enable `noUncheckedIndexedAccess` or `exactOptionalPropertyTypes`. The `no-unnecessary-type-assertion` cleanup this iteration revealed many `!` non-null assertions that were already safe — enabling `noUncheckedIndexedAccess` would catch new ones at compile time.

**Actions:**

- Enable `noUncheckedIndexedAccess: true` in `tsconfig.json`.
- Fix resulting type errors (primarily array index accesses without null checks).
- Enable `exactOptionalPropertyTypes: true` and fix any resulting gaps.
- Consider `useUnknownInCatchVariables: true` (already effective via the `restrict-template-expressions` fixes using `String(err)`).

---

### Priority 8 — Enterprise: Rate Limiter Redis Integration

**Status:** `src/enterprise/security/rate-limit.ts` has `InMemoryRateLimiter` (single-node) and `RedisRateLimiter` (multi-node). The factory `createRateLimiter(redisUrl?)` is implemented but needs integration testing.

**Actions:**

- Add integration tests for `RedisRateLimiter` using `testcontainers` (Redis Docker container in tests).
- Wire `createRateLimiter` into the gateway HTTP server startup (currently not called on startup).
- Add config key: `enterprise.security.rateLimit.redis` that maps to `cluster.redis.url`.

---

### Priority 9 — Audit: Elasticsearch / External Sink

**Status:** `src/enterprise/audit/sinks/syslog.ts` exists. A Syslog RFC-5424 sink is implemented. No Elasticsearch / OpenSearch sink exists yet — required for high-volume SOC 2 deployments.

**Actions:**

- Implement `src/enterprise/audit/sinks/elasticsearch.ts`:
  - Bulk-index audit events to Elasticsearch/OpenSearch index.
  - Configurable index pattern (e.g., `openclaw-audit-YYYY.MM.DD`).
  - Retry on failure with exponential backoff.
  - mTLS support for Elastic Cloud.
- Add config: `enterprise.audit.sink.elasticsearch.url`, `.index`, `.apiKey`.

---

### Priority 10 — Security Scan: SAST Coverage for non-skill code

**Status:** `security-scan.yml` has `skill-sast` which scans changed skill files on PRs. The core `src/enterprise/` code is only covered by CodeQL. Enterprise-specific patterns (e.g., OIDC misuse, credential leaks in audit events) are not in CodeQL's default query suite.

**Actions:**

- Add custom CodeQL queries or Semgrep rules targeting:
  - Audit events that include raw credentials (accidental logging of `password`, `token`, `apiKey` fields).
  - Template injection patterns in gateway message handlers.
  - Use of `eval()` / `Function()` in skill execution paths.
- Wire into `security-scan.yml` as a separate `sast-enterprise` job.

---

## Summary Table

| #   | Area                      | Effort | Security Impact | Status          |
| --- | ------------------------- | ------ | --------------- | --------------- |
| 1   | Pin Actions to SHA        | Low    | Critical        | Ready           |
| 2   | Re-enable Zizmor rules    | Low    | High            | Ready           |
| 3   | Container Trivy scan      | Low    | High            | Ready           |
| 4   | OIDC state → Redis        | Medium | High            | Design ready    |
| 5   | Trust boundary in chat    | Medium | High            | Design ready    |
| 6   | Re-enable dead code CI    | Low    | Medium          | Triaging needed |
| 7   | Stricter tsconfig         | Medium | Medium          | Ready           |
| 8   | Rate limiter Redis wiring | Medium | Medium          | Design ready    |
| 9   | Elasticsearch audit sink  | Medium | Low             | Design ready    |
| 10  | Enterprise SAST rules     | High   | High            | Research needed |
