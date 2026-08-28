/**
 * Enterprise configuration types.
 *
 * These are added to OpenClawConfig as `enterprise?: EnterpriseConfig`.
 * All fields are optional and default to disabled — zero-overhead in community mode.
 */

export type EnterpriseConfig = {
  /** Master enable switch. When false (default), all subsystems are no-ops. */
  enabled?: boolean;

  /** Encrypted secret storage backends. */
  secrets?: EnterpriseSecretsConfig;

  /** Identity & access management / RBAC. */
  iam?: EnterpriseIAMConfig;

  /** Tamper-evident audit logging. */
  audit?: EnterpriseAuditConfig;

  /** Prometheus metrics + health probes. */
  monitoring?: EnterpriseMonitoringConfig;

  /** Multi-tenancy (AsyncLocalStorage isolation). */
  tenancy?: EnterpriseTenancyConfig;

  /** Distributed cluster mode (Redis message bus, heartbeats). */
  cluster?: EnterpriseClusterConfig;

  /** Runtime guardrails configuration. */
  guardrails?: EnterpriseGuardrailsConfig;

  /** Skill supply chain security. */
  skills?: EnterpriseSkillsConfig;

  /** NVIDIA NIM + GPU integration. */
  nvidia?: EnterpriseNvidiaConfig;

  /** Palantir Foundry integration. */
  palantir?: EnterprisePalantirConfig;

  /** Authentication configuration (OIDC, MFA). */
  auth?: EnterpriseAuthConfig;

  /** Oracle Cloud Infrastructure integration. */
  oracle?: EnterpriseOracleConfig;
};

// ── NVIDIA ────────────────────────────────────────────────────────────────

export type NimModelCapability = "chat" | "tool-calling" | "reasoning" | "multi-agent";

export type NimModelConfig = {
  id: string;
  displayName?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  capabilities?: NimModelCapability[];
  /** Nemotron 3 Nano thinking budget mode. */
  thinkingBudget?: "configurable" | "none";
};

export type EnterpriseNimConfig = {
  enabled?: boolean;
  /** NIM endpoint URL — NVIDIA hosted or self-hosted. */
  endpoint?: string;
  /** API key — use secret references (env://, vault://, etc.). */
  apiKey?: string;
  /** Default model ID for requests. */
  defaultModel?: string;
  /** Fallback model provider when NIM is unreachable. */
  fallbackModel?: string;
  /** Registered NIM models. */
  models?: NimModelConfig[];
  healthCheck?: {
    enabled?: boolean;
    intervalMs?: number;
    endpoint?: string;
  };
  retry?: {
    maxRetries?: number;
    backoffMs?: number;
    maxBackoffMs?: number;
  };
};

export type NvidiaGpuMetricsConfig = {
  enabled?: boolean;
  pollIntervalMs?: number;
  alertThresholds?: {
    gpuUtilization?: number;
    memoryUtilization?: number;
    temperature?: number;
    powerDraw?: number;
  };
};

export type NvidiaGuardrailsConfig = {
  thinkingBudgetLimit?: {
    enabled?: boolean;
    maxThinkingTokens?: number;
    action?: "block" | "require-approval" | "warn";
  };
  costGuard?: {
    enabled?: boolean;
    limits?: Array<{
      scope: "per-user" | "per-tenant";
      period: "hourly" | "daily";
      maxTokens: number;
      action: "block" | "require-approval" | "warn";
    }>;
  };
  modelRoutingPolicy?: {
    enabled?: boolean;
    roleModelMap?: Record<string, string[]>;
  };
};

export type NemoClawInferenceProfile = "nvidia-cloud" | "local-nim" | "vllm";

export type NemoClawSandboxPolicy = {
  /** Network egress policy — hot-reloadable. */
  network?: {
    /** Default action for outbound connections. */
    defaultAction?: "block" | "allow";
    /** Allowed egress hostnames. */
    allowedHosts?: string[];
    /** Whether operator approval is required for unlisted hosts. */
    requireApproval?: boolean;
  };
  /** Filesystem access policy — locked at sandbox creation. */
  filesystem?: {
    /** Allowed read/write paths inside the sandbox. */
    allowedPaths?: string[];
    /** Read-only mount paths. */
    readOnlyPaths?: string[];
  };
  /** Process/syscall restrictions — locked at sandbox creation. */
  seccomp?: {
    /** Enable seccomp profile to block privilege escalation. */
    enabled?: boolean;
    /** Custom seccomp profile path. */
    profilePath?: string;
  };
};

export type NemoClawPrivacyRouterConfig = {
  /** Enable the privacy router for sensitive data handling. */
  enabled?: boolean;
  /** Models that may receive sensitive data (on-device only). */
  localOnlyModels?: string[];
  /** Cloud models allowed for non-sensitive data. */
  cloudModels?: string[];
  /** Classification mode for data sensitivity. */
  classificationMode?: "rule-based" | "model-based";
};

export type EnterpriseNemoClawConfig = {
  /** Enable NemoClaw Enterprise integration. */
  enabled?: boolean;
  /** Inference profile: nvidia-cloud, local-nim, or vllm. */
  inferenceProfile?: NemoClawInferenceProfile;
  /** NVIDIA API key for cloud inference (build.nvidia.com). Supports secret refs. */
  apiKey?: string;
  /** Default model for NemoClaw inference. */
  defaultModel?: string;
  /** OpenShell sandbox configuration. */
  sandbox?: {
    enabled?: boolean;
    /** Container image for OpenShell runtime. */
    image?: string;
    /** Declarative security policies. */
    policy?: NemoClawSandboxPolicy;
    /** Working directory inside the sandbox. */
    workDir?: string;
  };
  /** Privacy router configuration. */
  privacyRouter?: NemoClawPrivacyRouterConfig;
  /** Health check configuration. */
  healthCheck?: {
    enabled?: boolean;
    intervalMs?: number;
    endpoint?: string;
  };
  /** Retry configuration for inference requests. */
  retry?: {
    maxRetries?: number;
    backoffMs?: number;
    maxBackoffMs?: number;
  };
};

export type EnterpriseNvidiaConfig = {
  nim?: EnterpriseNimConfig;
  gpuMetrics?: NvidiaGpuMetricsConfig;
  /** NemoClaw Enterprise (OpenShell + sandboxed inference). */
  nemoClaw?: EnterpriseNemoClawConfig;
};

// ── Secrets ────────────────────────────────────────────────────────────────

export type EnterpriseSecretsConfig = {
  /** Backend type. Defaults to "file" when enterprise is enabled. */
  backend?: "file" | "vault" | "aws-sm" | "gcp-sm" | "azure-kv" | "oci-vault" | "env" | "none";

  /** Local path for the encrypted file backend. */
  filePath?: string;

  vault?: {
    address: string;
    token?: string;
    mount?: string;
    prefix?: string;
    namespace?: string;
    authMethod?: "token" | "approle" | "kubernetes";
    appRole?: { roleId: string; secretId: string };
    k8sAuth?: {
      role: string;
      serviceAccountTokenPath?: string;
      mountPath?: string;
    };
  };

  awsSm?: {
    region?: string;
    prefix?: string;
  };

  gcpSm?: {
    projectId: string;
    prefix?: string;
  };

  azureKv?: {
    vaultUrl: string;
    prefix?: string;
  };

  ociVault?: {
    tenancyId?: string;
    userId?: string;
    fingerprint?: string;
    privateKey?: string;
    region?: string;
    compartmentId?: string;
    vaultId?: string;
    keyId?: string;
    prefix?: string;
  };
};

// ── IAM ────────────────────────────────────────────────────────────────────

export type EnterpriseIAMConfig = {
  enabled?: boolean;

  jwt?: {
    algorithm?: "RS256" | "HS256";
    secret?: string; // HS256 only
    privateKeyPath?: string; // RS256 — auto-generated if absent
    publicKeyPath?: string; // RS256
    expiresIn?: string; // e.g. "15m"
    refreshExpiresIn?: string; // e.g. "7d"
    issuer?: string;
  };

  oidc?: {
    enabled?: boolean;
    issuer?: string;
    clientId?: string;
    clientSecret?: string;
    scopes?: string[];
  };
};

// ── Audit ──────────────────────────────────────────────────────────────────

export type EnterpriseAuditConfig = {
  enabled?: boolean;

  storage?: {
    driver?: "sqlite" | "postgresql";
    path?: string; // sqlite
    url?: string; // postgresql — use env:// reference
  };

  /** External audit sinks (syslog, webhook, palantir-foundry). */
  sinks?: AuditSinkConfig[];

  retention?: {
    /** Auto-purge events older than this many days. 0 = no purge. */
    days?: number;
  };
};

// ── Monitoring ─────────────────────────────────────────────────────────────

export type EnterpriseMonitoringConfig = {
  enabled?: boolean;
  /** Port to serve /metrics on (default: same as gateway port). */
  metricsPort?: number;
  /** Path prefix for metrics endpoint. Default: /metrics */
  metricsPath?: string;
};

// ── Tenancy ────────────────────────────────────────────────────────────────

export type EnterpriseTenancyConfig = {
  enabled?: boolean;

  tenants?: Array<{
    id: string;
    name?: string;
    description?: string;
    /** Disable a tenant without removing it from config. Default: true. */
    enabled?: boolean;
    /** Per-tenant resource limits. */
    limits?: {
      maxAgents?: number;
      maxSessionsPerAgent?: number;
      maxTokensPerDay?: number;
      maxSkills?: number;
      maxSandboxContainers?: number;
      allowedModels?: string[];
    };
    rateLimits?: {
      requestsPerMinute?: number;
    };
  }>;
};

// ── Cluster ────────────────────────────────────────────────────────────────

export type EnterpriseClusterConfig = {
  enabled?: boolean;

  /** Stable node identifier. Auto-generated (hostname + random suffix) when omitted. */
  nodeId?: string;

  redis?: {
    url?: string; // use env:// reference
    keyPrefix?: string;
  };

  /** Heartbeat interval in ms. Default: 10000. */
  heartbeatIntervalMs?: number;
};

// ── Guardrails ─────────────────────────────────────────────────────────────

export type EnterpriseGuardrailsConfig = {
  enabled?: boolean;

  rules?: Array<{
    id: string;
    description?: string;
    pattern?: string;
    action: "allow" | "warn" | "block" | "require-approval";
    scope?: "tool-input" | "tool-output" | "message";
  }>;

  /** NVIDIA-specific guardrail rules. */
  nvidia?: NvidiaGuardrailsConfig;
};

// ── Palantir Foundry ──────────────────────────────────────────────────────

export type PalantirFoundrySinkConfig = {
  type: "palantir-foundry";
  /** Foundry stack URL, e.g. https://myorg.palantirfoundry.com. Supports secret refs. */
  stackUrl: string;
  /** Developer Console app client ID. Supports secret refs. */
  clientId: string;
  /** Confidential OAuth client secret. Supports secret refs. */
  clientSecret: string;
  /** Ontology RID. Supports secret refs. */
  ontologyRid: string;
  /** Target streaming dataset RID. */
  streamRid: string;
  /** Events per write batch. Default: 50. */
  batchSize?: number;
  /** Max wait before flush in ms. Default: 5000. */
  flushIntervalMs?: number;
  /** Retries on transient failure. Default: 3. */
  retryAttempts?: number;
  /** Initial backoff between retries in ms. Default: 1000. */
  retryBackoffMs?: number;
  /** Max events in in-memory buffer. Default: 10000. */
  maxBufferSize?: number;
};

export type EnterprisePalantirConfig = {
  enabled?: boolean;
};

// ── Auth ──────────────────────────────────────────────────────────────────

export type OidcProviderPreset = "palantir" | "okta" | "azure-ad" | "google" | "auth0" | "keycloak";

export type EnterpriseOidcConfig = {
  enabled?: boolean;
  /** OIDC provider preset — auto-constructs discoveryUrl. */
  provider?: OidcProviderPreset;
  /** Stack URL for provider preset. Supports secret refs. */
  stackUrl?: string;
  /** Azure AD tenant ID (required for azure-ad preset). */
  tenantId?: string;
  /** Keycloak realm (required for keycloak preset). */
  realm?: string;
  /** Explicit discovery URL. Takes precedence over provider preset. */
  discoveryUrl?: string;
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  scopes?: string[];
  groupsClaim?: string;
  roleMap?: Record<string, string>;
  defaultRole?: string;
};

export type EnterpriseAuthConfig = {
  oidc?: EnterpriseOidcConfig;
  mfa?: {
    enabled?: boolean;
    requireForRoles?: string[];
  };
};

// ── Oracle Cloud ──────────────────────────────────────────────────────────

export type OciAuthConfig = {
  tenancyId?: string;
  userId?: string;
  fingerprint?: string;
  privateKey?: string;
  region?: string;
};

export type OciStreamingSinkConfig = {
  type: "oci-streaming";
  /** OCI Stream OCID. Supports secret refs. */
  streamId: string;
  /** Streaming endpoint URL. Supports secret refs. */
  streamEndpoint: string;
  /** OCI auth fields. */
  tenancyId?: string;
  userId?: string;
  fingerprint?: string;
  privateKey?: string;
  region?: string;
  /** Messages per PutMessages call. Default: 100. */
  batchSize?: number;
  /** Max wait before flush in ms. Default: 5000. */
  flushIntervalMs?: number;
  /** Partition key for ordering. Default: "openclaw-audit". */
  partitionKey?: string;
  /** Retries on transient failure. Default: 3. */
  retryAttempts?: number;
  /** Initial backoff between retries in ms. Default: 1000. */
  retryBackoffMs?: number;
  /** Max events in in-memory buffer. Default: 10000. */
  maxBufferSize?: number;
};

export type OracleMcpConfig = {
  enabled?: boolean;
  /** MCP SSE endpoint URL from Autonomous DB. Supports secret refs. */
  endpoint?: string;
  auth?: {
    method?: "oci-api-key" | "token";
    tenancyId?: string;
    userId?: string;
    fingerprint?: string;
    privateKey?: string;
    region?: string;
    bearerToken?: string;
  };
  allowedTools?: string[];
  blockedTools?: string[];
  requireApproval?: string[];
  maxResultRows?: number;
  queryTimeout?: number;
  healthCheckIntervalMs?: number;
};

export type OracleAgentSpecConfig = {
  enabled?: boolean;
  exportPath?: string;
  includeTools?: boolean;
  includeSystemPrompt?: boolean;
  redactSecrets?: boolean;
};

export type EnterpriseOracleConfig = {
  mcp?: OracleMcpConfig;
  agentSpec?: OracleAgentSpecConfig;
};

// ── Audit sinks ──────────────────────────────────────────────────────────

export type AuditSinkConfig =
  | {
      type: "syslog";
      host: string;
      port?: number;
      protocol?: "udp" | "tcp";
      facility?: number;
      appName?: string;
    }
  | {
      type: "webhook";
      url: string;
      headers?: Record<string, string>;
      batchSize?: number;
      flushIntervalMs?: number;
    }
  | PalantirFoundrySinkConfig
  | OciStreamingSinkConfig;

// ── Skills ────────────────────────────────────────────────────────────────

export type EnterpriseSkillsConfig = {
  /** Require Ed25519 signature verification before installing skills. */
  requireSigning?: boolean;

  /** Trusted Ed25519 public keys (base64). */
  trustedKeys?: string[];

  /** Run enterprise SAST before installing skills. */
  requireSast?: boolean;

  /** Max SAST risk score to allow auto-install (0–100). Default: 40. */
  maxRiskScore?: number;
};
