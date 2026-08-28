/**
 * Startup enforcement-gap safeguard tests.
 *
 * Verifies that initEnterprise refuses to boot (THROW) for dangerous controls
 * that are configured but not enforced (MFA), warns prominently (WARN, no throw)
 * for degraded-but-not-defeated controls (tenancy, NVIDIA guardrails, OIDC),
 * is silent for a bare enabled:true config, and loads config-declared guardrail
 * rules into the live engine.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { initEnterprise, assertEnterpriseEnforcementWired } from "./index.js";
import { getGuardrailEngine, setGuardrailEngine, GuardrailEngine } from "./security/guardrails.js";

/** Build a minimal enabled enterprise config with heavy subsystems disabled. */
function cfg(enterprise: Record<string, unknown>): OpenClawConfig {
  return {
    enterprise: {
      enabled: true,
      // Keep the test hermetic — do not spin up real subsystems.
      secrets: { backend: "none" },
      iam: { enabled: false },
      audit: { enabled: false },
      monitoring: { enabled: false },
      ...enterprise,
    },
  } as unknown as OpenClawConfig;
}

describe("assertEnterpriseEnforcementWired", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    // Reset the global guardrail engine between tests.
    setGuardrailEngine(new GuardrailEngine());
  });

  it("throws when MFA is configured (enabled)", () => {
    expect(() =>
      assertEnterpriseEnforcementWired(cfg({ auth: { mfa: { enabled: true } } })),
    ).toThrow(/MFA is configured .* NOT enforced at authentication/);
  });

  it("throws when MFA requireForRoles is set (even without enabled)", () => {
    expect(() =>
      assertEnterpriseEnforcementWired(cfg({ auth: { mfa: { requireForRoles: ["admin"] } } })),
    ).toThrow(/MFA is configured/);
  });

  it("warns (no throw) when per-tenant limits are configured", () => {
    expect(() =>
      assertEnterpriseEnforcementWired(
        cfg({
          tenancy: {
            enabled: true,
            tenants: [
              { id: "acme", limits: { allowedModels: ["gpt-4o-mini"], maxTokensPerDay: 1000 } },
            ],
          },
        }),
      ),
    ).not.toThrow();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/tenant/i);
  });

  it("warns (no throw) when NVIDIA guardrails are configured", () => {
    expect(() =>
      assertEnterpriseEnforcementWired(
        cfg({
          guardrails: {
            nvidia: { costGuard: { enabled: true, limits: [] } },
          },
        }),
      ),
    ).not.toThrow();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/NVIDIA guardrails/);
  });

  it("warns (no throw) when OIDC is enabled", () => {
    expect(() =>
      assertEnterpriseEnforcementWired(cfg({ auth: { oidc: { enabled: true } } })),
    ).not.toThrow();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/OIDC/);
  });

  it("is silent (no throw, no warn) for a bare enabled config", () => {
    expect(() => assertEnterpriseEnforcementWired(cfg({}))).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does nothing when enterprise is absent", () => {
    expect(() => assertEnterpriseEnforcementWired({} as OpenClawConfig)).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("initEnterprise enforcement-gap integration", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    setGuardrailEngine(new GuardrailEngine());
  });

  afterEach(() => {
    warnSpy.mockRestore();
    setGuardrailEngine(new GuardrailEngine());
  });

  it("rejects boot when MFA is configured", async () => {
    await expect(initEnterprise(cfg({ auth: { mfa: { enabled: true } } }))).rejects.toThrow(
      /MFA is configured/,
    );
  });

  it("boots (no throw) with a bare enabled config", async () => {
    const handle = await initEnterprise(cfg({}));
    expect(handle).toBeTruthy();
    // No enforcement-gap warning for a bare config. (Guardrails wiring itself
    // does not warn unless a rule is invalid.)
    expect(warnSpy).not.toHaveBeenCalled();
    await handle.shutdown();
  });

  it("loads config-declared guardrail rules into the live engine", async () => {
    const handle = await initEnterprise(
      cfg({
        guardrails: {
          rules: [{ id: "block-fizz", pattern: "fizzbuzz", action: "block", scope: "tool-input" }],
        },
      }),
    );

    const result = getGuardrailEngine().evaluate({
      tool: "bash",
      input: { command: "run fizzbuzz" },
    });
    expect(result.action).toBe("block");
    expect(result.triggered.some((t) => t.rule.id === "block-fizz")).toBe(true);

    // Default rules must still be present alongside the config rule.
    const ccResult = getGuardrailEngine().evaluate({
      tool: "bash",
      output: "card 4111111111111111",
    });
    expect(ccResult.triggered.some((t) => t.rule.id === "output-credit-card")).toBe(true);

    await handle.shutdown();

    // Shutdown restores the default engine — the config rule is gone.
    const after = getGuardrailEngine().evaluate({
      tool: "bash",
      input: { command: "run fizzbuzz" },
    });
    expect(after.triggered.some((t) => t.rule.id === "block-fizz")).toBe(false);
  });

  it("warns but boots when guardrail rules are invalid", async () => {
    const handle = await initEnterprise(
      cfg({
        guardrails: {
          rules: [
            // No pattern → dropped and reported as an error by buildGuardrailRulesFromConfig.
            { id: "bad-rule", action: "block" },
          ],
        },
      }),
    );
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("bad-rule"))).toBe(true);
    await handle.shutdown();
  });
});
