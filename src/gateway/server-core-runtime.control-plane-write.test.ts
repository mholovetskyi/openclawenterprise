// Verifies that mutating enterprise admin RPCs are classified as control-plane
// writes (so they are subject to the control-plane write rate limiter that
// guards core admin mutations) while read-only enterprise RPCs are not. This
// mirrors how server-core-runtime builds the attached method registry: aux
// descriptors from the enterprise handler table, passed through
// markControlPlaneWriteAuxDescriptors.
import { describe, expect, it } from "vitest";
import { enterpriseHandlers } from "./enterprise-methods.js";
import { ADMIN_SCOPE } from "./method-scopes.js";
import {
  createGatewayMethodDescriptorsFromHandlers,
  createGatewayMethodRegistry,
} from "./methods/registry.js";
import {
  CONTROL_PLANE_WRITE_AUX_METHODS,
  markControlPlaneWriteAuxDescriptors,
} from "./server-core-runtime.js";

function buildEnterpriseRegistry() {
  const descriptors = markControlPlaneWriteAuxDescriptors(
    createGatewayMethodDescriptorsFromHandlers({
      handlers: enterpriseHandlers,
      owner: { kind: "aux", area: "gateway-extra" },
      defaultScope: ADMIN_SCOPE,
    }),
  );
  return createGatewayMethodRegistry(descriptors);
}

describe("enterprise aux control-plane write classification", () => {
  const registry = buildEnterpriseRegistry();

  const MUTATING = [
    "enterprise.users.upsert",
    "enterprise.users.delete",
    "enterprise.sessions.revoke",
    "enterprise.gdpr.erase",
    "enterprise.mfa.confirm-enroll",
    "enterprise.mfa.disable",
  ];

  const READ_ONLY = [
    "enterprise.users.list",
    "enterprise.users.get",
    "enterprise.roles.list",
    "enterprise.sessions.list",
    "enterprise.audit.query",
    "enterprise.audit.export",
    "enterprise.gdpr.export",
    "enterprise.mfa.enroll",
    "enterprise.mfa.verify",
    "enterprise.ip-allowlist.check",
  ];

  it("marks every mutating enterprise RPC as a control-plane write", () => {
    for (const method of MUTATING) {
      expect(registry.getHandler(method), `${method} must be registered`).toBeDefined();
      expect(registry.isControlPlaneWrite(method), method).toBe(true);
    }
  });

  it("does NOT mark read-only enterprise RPCs as control-plane writes", () => {
    for (const method of READ_ONLY) {
      expect(registry.getHandler(method), `${method} must be registered`).toBeDefined();
      expect(registry.isControlPlaneWrite(method), method).toBe(false);
    }
  });

  it("classifies every enterprise handler as either mutating or read-only (no drift)", () => {
    const all = Object.keys(enterpriseHandlers).toSorted();
    expect(all).toEqual([...MUTATING, ...READ_ONLY].toSorted());
  });

  it("the write set contains only known enterprise handler names", () => {
    for (const method of CONTROL_PLANE_WRITE_AUX_METHODS) {
      expect(Object.keys(enterpriseHandlers), method).toContain(method);
    }
  });
});
