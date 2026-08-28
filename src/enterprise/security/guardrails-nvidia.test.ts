import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  evaluateThinkingBudgetLimit,
  evaluateCostGuard,
  evaluateModelRoutingPolicy,
  evaluateNvidiaGuardrails,
  createTokenUsageTracker,
  setTokenUsageTracker,
  NVIDIA_GUARDRAIL_AUDIT_ACTIONS,
  type NvidiaGuardrailContext,
} from "./guardrails-nvidia.js";

// Mock audit logger
const mockAuditLogSync = vi.fn();
vi.mock("../audit/logger.js", () => ({
  auditLog: vi.fn(async () => null),
  auditLogSync: (...args: unknown[]) => mockAuditLogSync(...args),
}));

// Mock tenancy
vi.mock("../tenancy/index.js", () => ({
  getTenantContext: vi.fn(() => ({
    tenantId: "test-tenant",
    tenantName: "Test Tenant",
  })),
}));

describe("evaluateThinkingBudgetLimit", () => {
  beforeEach(() => {
    mockAuditLogSync.mockClear();
  });

  it("allows when disabled", () => {
    const ctx: NvidiaGuardrailContext = {
      tool: "chat",
      model: "nvidia/nemotron-3-nano-30b-a3b",
      thinkingBudgetTokens: 8000,
    };
    const result = evaluateThinkingBudgetLimit(ctx, { enabled: false });
    expect(result.action).toBe("allow");
  });

  it("allows when model is not a thinking model", () => {
    const ctx: NvidiaGuardrailContext = {
      tool: "chat",
      model: "nvidia/llama-3.1-nemotron-nano-8b-v1",
      thinkingBudgetTokens: 8000,
    };
    const result = evaluateThinkingBudgetLimit(ctx, {
      enabled: true,
      maxThinkingTokens: 4096,
    });
    expect(result.action).toBe("allow");
  });

  it("allows when thinking budget is within limit", () => {
    const ctx: NvidiaGuardrailContext = {
      tool: "chat",
      model: "nvidia/nemotron-3-nano-30b-a3b",
      thinkingBudgetTokens: 2048,
    };
    const result = evaluateThinkingBudgetLimit(ctx, {
      enabled: true,
      maxThinkingTokens: 4096,
    });
    expect(result.action).toBe("allow");
  });

  it("blocks when thinking budget exceeds limit with require-approval", () => {
    const ctx: NvidiaGuardrailContext = {
      tool: "chat",
      model: "nvidia/nemotron-3-nano-30b-a3b",
      thinkingBudgetTokens: 8192,
      userId: "user-1",
    };
    const result = evaluateThinkingBudgetLimit(ctx, {
      enabled: true,
      maxThinkingTokens: 4096,
      action: "require-approval",
    });
    expect(result.action).toBe("require-approval");
    expect(result.triggered).toHaveLength(1);
    expect(result.triggered[0]!.rule.id).toBe("thinking-budget-limit");
    expect(result.triggered[0]!.reason).toContain("8192");
    expect(result.triggered[0]!.reason).toContain("4096");
  });

  it("uses default maxThinkingTokens of 4096", () => {
    const ctx: NvidiaGuardrailContext = {
      tool: "chat",
      model: "nvidia/nemotron-3-nano-30b-a3b",
      thinkingBudgetTokens: 5000,
    };
    const result = evaluateThinkingBudgetLimit(ctx, { enabled: true });
    expect(result.action).toBe("require-approval"); // default action
  });

  it("emits audit event when budget exceeded", () => {
    const ctx: NvidiaGuardrailContext = {
      tool: "chat",
      model: "nvidia/nemotron-3-nano-30b-a3b",
      thinkingBudgetTokens: 8000,
      userId: "user-1",
    };
    evaluateThinkingBudgetLimit(ctx, {
      enabled: true,
      maxThinkingTokens: 4096,
      action: "warn",
    });
    expect(mockAuditLogSync).toHaveBeenCalledWith(
      expect.objectContaining({
        action: NVIDIA_GUARDRAIL_AUDIT_ACTIONS.THINKING_BUDGET_EXCEEDED,
        outcome: "denied",
      }),
    );
  });

  it("allows when no model is specified", () => {
    const ctx: NvidiaGuardrailContext = { tool: "chat" };
    const result = evaluateThinkingBudgetLimit(ctx, {
      enabled: true,
      maxThinkingTokens: 4096,
    });
    expect(result.action).toBe("allow");
  });
});

describe("evaluateCostGuard", () => {
  beforeEach(() => {
    mockAuditLogSync.mockClear();
    const tracker = createTokenUsageTracker();
    setTokenUsageTracker(tracker);
  });

  it("allows when disabled", () => {
    const ctx: NvidiaGuardrailContext = { tool: "chat", userId: "user-1" };
    const result = evaluateCostGuard(ctx, { enabled: false });
    expect(result.action).toBe("allow");
  });

  it("allows when no limits are configured", () => {
    const ctx: NvidiaGuardrailContext = { tool: "chat", userId: "user-1" };
    const result = evaluateCostGuard(ctx, { enabled: true, limits: [] });
    expect(result.action).toBe("allow");
  });

  it("allows when usage is below threshold", () => {
    const tracker = createTokenUsageTracker();
    tracker.addUsage("user:user-1:hourly", 1000);
    setTokenUsageTracker(tracker);

    const ctx: NvidiaGuardrailContext = { tool: "chat", userId: "user-1" };
    const result = evaluateCostGuard(ctx, {
      enabled: true,
      limits: [{ scope: "per-user", period: "hourly", maxTokens: 500000, action: "warn" }],
    });
    expect(result.action).toBe("allow");
  });

  it("warns when per-user hourly usage exceeds threshold", () => {
    const tracker = createTokenUsageTracker();
    tracker.addUsage("user:user-1:hourly", 600000);
    setTokenUsageTracker(tracker);

    const ctx: NvidiaGuardrailContext = { tool: "chat", userId: "user-1" };
    const result = evaluateCostGuard(ctx, {
      enabled: true,
      limits: [{ scope: "per-user", period: "hourly", maxTokens: 500000, action: "warn" }],
    });
    expect(result.action).toBe("warn");
    expect(result.triggered).toHaveLength(1);
    expect(result.triggered[0]!.rule.id).toBe("nim-cost-guard");
  });

  it("uses per-tenant tracking when scope is per-tenant", () => {
    const tracker = createTokenUsageTracker();
    tracker.addUsage("tenant:test-tenant:daily", 15000000);
    setTokenUsageTracker(tracker);

    const ctx: NvidiaGuardrailContext = { tool: "chat", userId: "user-1" };
    const result = evaluateCostGuard(ctx, {
      enabled: true,
      limits: [
        { scope: "per-tenant", period: "daily", maxTokens: 10000000, action: "require-approval" },
      ],
    });
    expect(result.action).toBe("require-approval");
  });

  it("picks most restrictive action across multiple limits", () => {
    const tracker = createTokenUsageTracker();
    tracker.addUsage("user:user-1:hourly", 600000);
    tracker.addUsage("tenant:test-tenant:daily", 15000000);
    setTokenUsageTracker(tracker);

    const ctx: NvidiaGuardrailContext = { tool: "chat", userId: "user-1" };
    const result = evaluateCostGuard(ctx, {
      enabled: true,
      limits: [
        { scope: "per-user", period: "hourly", maxTokens: 500000, action: "warn" },
        { scope: "per-tenant", period: "daily", maxTokens: 10000000, action: "block" },
      ],
    });
    expect(result.action).toBe("block");
    expect(result.triggered).toHaveLength(2);
  });

  it("emits audit event on threshold breach", () => {
    const tracker = createTokenUsageTracker();
    tracker.addUsage("user:user-1:hourly", 600000);
    setTokenUsageTracker(tracker);

    const ctx: NvidiaGuardrailContext = { tool: "chat", userId: "user-1" };
    evaluateCostGuard(ctx, {
      enabled: true,
      limits: [{ scope: "per-user", period: "hourly", maxTokens: 500000, action: "warn" }],
    });
    expect(mockAuditLogSync).toHaveBeenCalledWith(
      expect.objectContaining({
        action: NVIDIA_GUARDRAIL_AUDIT_ACTIONS.COST_GUARD_TRIGGERED,
      }),
    );
  });
});

describe("evaluateModelRoutingPolicy", () => {
  beforeEach(() => {
    mockAuditLogSync.mockClear();
  });

  const roleModelMap = {
    viewer: ["nvidia/llama-3.1-nemotron-nano-8b-v1"],
    operator: ["nvidia/llama-3.1-nemotron-nano-8b-v1", "nvidia/nemotron-3-nano-30b-a3b"],
    admin: ["*"],
    "super-admin": ["*"],
  };

  it("allows when disabled", () => {
    const ctx: NvidiaGuardrailContext = {
      tool: "chat",
      model: "nvidia/nemotron-3-nano-30b-a3b",
      userRoles: ["viewer"],
    };
    const result = evaluateModelRoutingPolicy(ctx, { enabled: false });
    expect(result.action).toBe("allow");
  });

  it("allows when no model is specified", () => {
    const ctx: NvidiaGuardrailContext = { tool: "chat", userRoles: ["viewer"] };
    const result = evaluateModelRoutingPolicy(ctx, { enabled: true, roleModelMap });
    expect(result.action).toBe("allow");
  });

  it("allows viewer to use Nano 8B", () => {
    const ctx: NvidiaGuardrailContext = {
      tool: "chat",
      model: "nvidia/llama-3.1-nemotron-nano-8b-v1",
      userRoles: ["viewer"],
    };
    const result = evaluateModelRoutingPolicy(ctx, { enabled: true, roleModelMap });
    expect(result.action).toBe("allow");
  });

  it("blocks viewer from using Nano 30B", () => {
    const ctx: NvidiaGuardrailContext = {
      tool: "chat",
      model: "nvidia/nemotron-3-nano-30b-a3b",
      userRoles: ["viewer"],
      userId: "user-1",
    };
    const result = evaluateModelRoutingPolicy(ctx, { enabled: true, roleModelMap });
    expect(result.action).toBe("block");
    expect(result.triggered).toHaveLength(1);
    expect(result.triggered[0]!.rule.id).toBe("model-routing-policy");
  });

  it("allows operator to use Nano 30B", () => {
    const ctx: NvidiaGuardrailContext = {
      tool: "chat",
      model: "nvidia/nemotron-3-nano-30b-a3b",
      userRoles: ["operator"],
    };
    const result = evaluateModelRoutingPolicy(ctx, { enabled: true, roleModelMap });
    expect(result.action).toBe("allow");
  });

  it("allows admin to use any model via wildcard", () => {
    const ctx: NvidiaGuardrailContext = {
      tool: "chat",
      model: "nvidia/llama-3.3-nemotron-super-49b-v1",
      userRoles: ["admin"],
    };
    const result = evaluateModelRoutingPolicy(ctx, { enabled: true, roleModelMap });
    expect(result.action).toBe("allow");
  });

  it("allows if any role grants access", () => {
    const ctx: NvidiaGuardrailContext = {
      tool: "chat",
      model: "nvidia/nemotron-3-nano-30b-a3b",
      userRoles: ["viewer", "operator"],
    };
    const result = evaluateModelRoutingPolicy(ctx, { enabled: true, roleModelMap });
    expect(result.action).toBe("allow");
  });

  it("blocks when user has no roles", () => {
    const ctx: NvidiaGuardrailContext = {
      tool: "chat",
      model: "nvidia/nemotron-3-nano-30b-a3b",
      userRoles: [],
    };
    const result = evaluateModelRoutingPolicy(ctx, { enabled: true, roleModelMap });
    expect(result.action).toBe("block");
  });

  it("emits audit event when access is denied", () => {
    const ctx: NvidiaGuardrailContext = {
      tool: "chat",
      model: "nvidia/llama-3.3-nemotron-super-49b-v1",
      userRoles: ["viewer"],
      userId: "user-1",
    };
    evaluateModelRoutingPolicy(ctx, { enabled: true, roleModelMap });
    expect(mockAuditLogSync).toHaveBeenCalledWith(
      expect.objectContaining({
        action: NVIDIA_GUARDRAIL_AUDIT_ACTIONS.MODEL_ROUTING_DENIED,
        outcome: "denied",
      }),
    );
  });
});

describe("evaluateNvidiaGuardrails (composite)", () => {
  beforeEach(() => {
    mockAuditLogSync.mockClear();
    setTokenUsageTracker(createTokenUsageTracker());
  });

  it("allows when no config provided", () => {
    const ctx: NvidiaGuardrailContext = { tool: "chat" };
    const result = evaluateNvidiaGuardrails(ctx, undefined);
    expect(result.action).toBe("allow");
  });

  it("picks most restrictive action across all rules", () => {
    const ctx: NvidiaGuardrailContext = {
      tool: "chat",
      model: "nvidia/nemotron-3-nano-30b-a3b",
      thinkingBudgetTokens: 8000,
      userRoles: ["viewer"],
      userId: "user-1",
    };

    const result = evaluateNvidiaGuardrails(ctx, {
      thinkingBudgetLimit: {
        enabled: true,
        maxThinkingTokens: 4096,
        action: "warn",
      },
      modelRoutingPolicy: {
        enabled: true,
        roleModelMap: {
          viewer: ["nvidia/llama-3.1-nemotron-nano-8b-v1"],
        },
      },
    });

    // model-routing-policy blocks, thinking-budget warns → block wins
    expect(result.action).toBe("block");
    expect(result.triggered.length).toBeGreaterThanOrEqual(2);
  });

  it("allows when all rules pass", () => {
    const ctx: NvidiaGuardrailContext = {
      tool: "chat",
      model: "nvidia/nemotron-3-nano-30b-a3b",
      thinkingBudgetTokens: 2000,
      userRoles: ["admin"],
      userId: "user-1",
    };

    const result = evaluateNvidiaGuardrails(ctx, {
      thinkingBudgetLimit: {
        enabled: true,
        maxThinkingTokens: 4096,
        action: "require-approval",
      },
      modelRoutingPolicy: {
        enabled: true,
        roleModelMap: { admin: ["*"] },
      },
    });

    expect(result.action).toBe("allow");
    expect(result.triggered).toHaveLength(0);
  });
});

describe("createTokenUsageTracker", () => {
  it("starts at zero", () => {
    const tracker = createTokenUsageTracker();
    expect(tracker.getUsage("user:test:hourly", "hourly")).toBe(0);
  });

  it("accumulates tokens", () => {
    const tracker = createTokenUsageTracker();
    tracker.addUsage("user:test:hourly", 100);
    tracker.addUsage("user:test:hourly", 200);
    expect(tracker.getUsage("user:test:hourly", "hourly")).toBe(300);
  });

  it("reset clears all usage", () => {
    const tracker = createTokenUsageTracker();
    tracker.addUsage("user:test:hourly", 500);
    tracker.reset();
    expect(tracker.getUsage("user:test:hourly", "hourly")).toBe(0);
  });
});

describe("NVIDIA Guardrail Audit Actions", () => {
  it("follows naming convention", () => {
    expect(NVIDIA_GUARDRAIL_AUDIT_ACTIONS.THINKING_BUDGET_EXCEEDED).toBe(
      "nvidia.guardrail.thinking_budget_exceeded",
    );
    expect(NVIDIA_GUARDRAIL_AUDIT_ACTIONS.COST_GUARD_TRIGGERED).toBe(
      "nvidia.guardrail.cost_guard_triggered",
    );
    expect(NVIDIA_GUARDRAIL_AUDIT_ACTIONS.MODEL_ROUTING_DENIED).toBe(
      "nvidia.guardrail.model_routing_denied",
    );
  });
});
