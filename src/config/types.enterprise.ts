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
};

// ── NVIDIA ────────────────────────────────────────────────────────────────

export type NimModelCapability =
  | "chat"
  | "tool-calling"
  | "reasoning"
  | "multi-agent";

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

export type EnterpriseNvidiaConfig = {
  nim?: EnterpriseNimConfig;
  gpuMetrics?: NvidiaGpuMetricsConfig;
};

// ── Secrets ────────────────────────────────────────────────────────────────

export type EnterpriseSecretsConfig = {
  /** Backend type. Defaults to "file" when enterprise is enabled. */
  backend?: "file" | "vault" | "aws-sm" | "gcp-sm" | "azure-kv" | "env" | "none";

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
};

// ── IAM ────────────────────────────────────────────────────────────────────

export type EnterpriseIAMConfig = {
  enabled?: boolean;

  jwt?: {
    algorithm?: "RS256" | "HS256";
    secret?: string;               // HS256 only
    privateKeyPath?: string;       // RS256 — auto-generated if absent
    publicKeyPath?: string;        // RS256
    expiresIn?: string;            // e.g. "15m"
    refreshExpiresIn?: string;     // e.g. "7d"
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
    path?: string;         // sqlite
    url?: string;          // postgresql — use env:// reference
  };

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
    rateLimits?: {
      requestsPerMinute?: number;
    };
  }>;
};

// ── Cluster ────────────────────────────────────────────────────────────────

export type EnterpriseClusterConfig = {
  enabled?: boolean;

  redis?: {
    url?: string;   // use env:// reference
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
