/**
 * NVIDIA-specific guardrail rules for Nemotron model behavior.
 *
 * - thinking-budget-limit: Enforce max thinking tokens for Nemotron 3 Nano
 * - nim-cost-guard: Track cumulative NIM token usage per user/tenant
 * - model-routing-policy: RBAC-based model access control
 *
 * Integrates with the existing GuardrailEngine and emits standard audit events.
 */

import type { NvidiaGuardrailsConfig } from "../../config/types.enterprise.js";
import type { GuardrailAction, GuardrailContext, GuardrailResult } from "./guardrails.js";
import { auditLogSync } from "../audit/logger.js";
import { getTenantContext } from "../tenancy/index.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type NvidiaGuardrailContext = GuardrailContext & {
  model?: string;
  thinkingBudgetTokens?: number;
  userRoles?: string[];
  userId?: string;
};

export type TokenUsageTracker = {
  getUsage(key: string, period: "hourly" | "daily"): number;
  addUsage(key: string, tokens: number): void;
  reset(): void;
};

// ── Audit Actions ────────────────────────────────────────────────────────────

export const NVIDIA_GUARDRAIL_AUDIT_ACTIONS = {
  THINKING_BUDGET_EXCEEDED: "nvidia.guardrail.thinking_budget_exceeded",
  COST_GUARD_TRIGGERED: "nvidia.guardrail.cost_guard_triggered",
  MODEL_ROUTING_DENIED: "nvidia.guardrail.model_routing_denied",
} as const;

// ── Token usage tracking ─────────────────────────────────────────────────────

type UsageEntry = {
  tokens: number;
  hourlyReset: number;
  dailyReset: number;
};

export function createTokenUsageTracker(): TokenUsageTracker {
  const store = new Map<string, UsageEntry>();

  function getEntry(key: string): UsageEntry {
    let entry = store.get(key);
    const now = Date.now();
    if (!entry) {
      entry = { tokens: 0, hourlyReset: now, dailyReset: now };
      store.set(key, entry);
      return entry;
    }

    // Reset hourly counters
    if (now - entry.hourlyReset > 3600000) {
      entry.tokens = 0;
      entry.hourlyReset = now;
    }

    return entry;
  }

  return {
    getUsage(key: string, period: "hourly" | "daily"): number {
      const entry = getEntry(key);
      const now = Date.now();

      if (period === "daily" && now - entry.dailyReset > 86400000) {
        entry.tokens = 0;
        entry.dailyReset = now;
      }

      return entry.tokens;
    },

    addUsage(key: string, tokens: number): void {
      const entry = getEntry(key);
      entry.tokens += tokens;
    },

    reset(): void {
      store.clear();
    },
  };
}

// Global usage tracker
let usageTracker: TokenUsageTracker | null = null;

export function getTokenUsageTracker(): TokenUsageTracker {
  if (!usageTracker) {
    usageTracker = createTokenUsageTracker();
  }
  return usageTracker;
}

export function setTokenUsageTracker(tracker: TokenUsageTracker): void {
  usageTracker = tracker;
}

// ── Rule: thinking-budget-limit ──────────────────────────────────────────────

const NEMOTRON_THINKING_MODELS = new Set([
  "nvidia/nemotron-3-nano-30b-a3b",
]);

export function evaluateThinkingBudgetLimit(
  ctx: NvidiaGuardrailContext,
  config: NvidiaGuardrailsConfig["thinkingBudgetLimit"],
): GuardrailResult {
  if (!config?.enabled) {
    return { action: "allow", triggered: [] };
  }

  // Only applies to Nemotron models with configurable thinking
  if (!ctx.model || !NEMOTRON_THINKING_MODELS.has(ctx.model)) {
    return { action: "allow", triggered: [] };
  }

  const maxTokens = config.maxThinkingTokens ?? 4096;
  const requestedTokens = ctx.thinkingBudgetTokens ?? 0;

  if (requestedTokens > maxTokens) {
    const action = config.action ?? "require-approval";

    auditLogSync({
      action: NVIDIA_GUARDRAIL_AUDIT_ACTIONS.THINKING_BUDGET_EXCEEDED,
      category: "security",
      actor: { type: "system", id: ctx.userId ?? "unknown" },
      outcome: "denied",
      metadata: {
        model: ctx.model,
        requestedTokens,
        maxTokens,
        action,
      },
    });

    return {
      action,
      triggered: [{
        rule: {
          id: "thinking-budget-limit",
          description: "Thinking budget exceeds configured limit",
          match: {},
          action,
        },
        reason: `Thinking budget ${requestedTokens} exceeds limit ${maxTokens}`,
      }],
    };
  }

  return { action: "allow", triggered: [] };
}

// ── Rule: nim-cost-guard ─────────────────────────────────────────────────────

export function evaluateCostGuard(
  ctx: NvidiaGuardrailContext,
  config: NvidiaGuardrailsConfig["costGuard"],
): GuardrailResult {
  if (!config?.enabled || !config.limits?.length) {
    return { action: "allow", triggered: [] };
  }

  const tracker = getTokenUsageTracker();
  const tenantCtx = getTenantContext();

  const triggered: GuardrailResult["triggered"] = [];
  let maxAction: GuardrailAction = "allow";

  const ACTION_PRIORITY: Record<GuardrailAction, number> = {
    allow: 0,
    warn: 1,
    "require-approval": 2,
    block: 3,
  };

  for (const limit of config.limits) {
    let key: string;
    if (limit.scope === "per-user") {
      key = `user:${ctx.userId ?? "anonymous"}`;
    } else {
      key = `tenant:${tenantCtx.tenantId}`;
    }
    key = `${key}:${limit.period}`;

    const usage = tracker.getUsage(key, limit.period);

    if (usage >= limit.maxTokens) {
      const action = limit.action ?? "warn";

      auditLogSync({
        action: NVIDIA_GUARDRAIL_AUDIT_ACTIONS.COST_GUARD_TRIGGERED,
        category: "security",
        actor: {
          type: ctx.userId ? "user" : "system",
          id: ctx.userId ?? "system",
          tenantId: tenantCtx.tenantId,
        },
        outcome: "denied",
        metadata: {
          scope: limit.scope,
          period: limit.period,
          currentUsage: usage,
          maxTokens: limit.maxTokens,
          action,
        },
      });

      triggered.push({
        rule: {
          id: "nim-cost-guard",
          description: `NIM token usage exceeds ${limit.period} limit for ${limit.scope}`,
          match: {},
          action,
        },
        reason: `${limit.scope} ${limit.period} token usage ${usage} exceeds limit ${limit.maxTokens}`,
      });

      if (ACTION_PRIORITY[action] > ACTION_PRIORITY[maxAction]) {
        maxAction = action;
      }
    }
  }

  return { action: maxAction, triggered };
}

// ── Rule: model-routing-policy ───────────────────────────────────────────────

export function evaluateModelRoutingPolicy(
  ctx: NvidiaGuardrailContext,
  config: NvidiaGuardrailsConfig["modelRoutingPolicy"],
): GuardrailResult {
  if (!config?.enabled || !config.roleModelMap || !ctx.model) {
    return { action: "allow", triggered: [] };
  }

  const roles = ctx.userRoles ?? [];

  // Check if any of the user's roles allow this model
  for (const role of roles) {
    const allowedModels = config.roleModelMap[role];
    if (!allowedModels) {continue;}

    // Wildcard — all models allowed
    if (allowedModels.includes("*")) {
      return { action: "allow", triggered: [] };
    }

    if (allowedModels.includes(ctx.model)) {
      return { action: "allow", triggered: [] };
    }
  }

  // No role grants access to this model
  auditLogSync({
    action: NVIDIA_GUARDRAIL_AUDIT_ACTIONS.MODEL_ROUTING_DENIED,
    category: "security",
    actor: {
      type: ctx.userId ? "user" : "anonymous",
      id: ctx.userId ?? "anonymous",
    },
    outcome: "denied",
    metadata: {
      model: ctx.model,
      userRoles: roles,
    },
  });

  return {
    action: "block",
    triggered: [{
      rule: {
        id: "model-routing-policy",
        description: "User role does not permit access to this model",
        match: {},
        action: "block",
      },
      reason: `Roles [${roles.join(", ")}] do not have access to model ${ctx.model}`,
    }],
  };
}

// ── Composite evaluator ──────────────────────────────────────────────────────

export function evaluateNvidiaGuardrails(
  ctx: NvidiaGuardrailContext,
  config: NvidiaGuardrailsConfig | undefined,
): GuardrailResult {
  if (!config) {
    return { action: "allow", triggered: [] };
  }

  const ACTION_PRIORITY: Record<GuardrailAction, number> = {
    allow: 0,
    warn: 1,
    "require-approval": 2,
    block: 3,
  };

  const results = [
    evaluateThinkingBudgetLimit(ctx, config.thinkingBudgetLimit),
    evaluateCostGuard(ctx, config.costGuard),
    evaluateModelRoutingPolicy(ctx, config.modelRoutingPolicy),
  ];

  let maxAction: GuardrailAction = "allow";
  const allTriggered: GuardrailResult["triggered"] = [];

  for (const result of results) {
    allTriggered.push(...result.triggered);
    if (ACTION_PRIORITY[result.action] > ACTION_PRIORITY[maxAction]) {
      maxAction = result.action;
    }
  }

  return { action: maxAction, triggered: allTriggered };
}
