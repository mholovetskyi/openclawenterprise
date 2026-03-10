import { describe, it, expect } from "vitest";
import { resolveOidcDiscoveryUrl } from "./oidc.js";

describe("OIDC Provider Presets", () => {
  it("should construct Palantir discovery URL from stackUrl", () => {
    const url = resolveOidcDiscoveryUrl({
      provider: "palantir",
      stackUrl: "https://myorg.palantirfoundry.com",
    });
    expect(url).toBe("https://myorg.palantirfoundry.com/.well-known/openid-configuration");
  });

  it("should construct Okta discovery URL from stackUrl", () => {
    const url = resolveOidcDiscoveryUrl({
      provider: "okta",
      stackUrl: "https://mycompany.okta.com",
    });
    expect(url).toBe("https://mycompany.okta.com/.well-known/openid-configuration");
  });

  it("should construct Azure AD discovery URL from tenantId", () => {
    const url = resolveOidcDiscoveryUrl({
      provider: "azure-ad",
      tenantId: "abc-123-def",
    });
    expect(url).toBe(
      "https://login.microsoftonline.com/abc-123-def/v2.0/.well-known/openid-configuration",
    );
  });

  it("should return static Google discovery URL", () => {
    const url = resolveOidcDiscoveryUrl({ provider: "google" });
    expect(url).toBe("https://accounts.google.com/.well-known/openid-configuration");
  });

  it("should construct Auth0 discovery URL from stackUrl", () => {
    const url = resolveOidcDiscoveryUrl({
      provider: "auth0",
      stackUrl: "https://myapp.us.auth0.com",
    });
    expect(url).toBe("https://myapp.us.auth0.com/.well-known/openid-configuration");
  });

  it("should construct Keycloak discovery URL from stackUrl and realm", () => {
    const url = resolveOidcDiscoveryUrl({
      provider: "keycloak",
      stackUrl: "https://keycloak.internal",
      realm: "openclaw",
    });
    expect(url).toBe("https://keycloak.internal/realms/openclaw/.well-known/openid-configuration");
  });

  it("should let discoveryUrl take precedence over provider preset", () => {
    const url = resolveOidcDiscoveryUrl({
      discoveryUrl: "https://custom.idp.example.com/.well-known/openid-configuration",
      provider: "palantir",
      stackUrl: "https://myorg.palantirfoundry.com",
    });
    expect(url).toBe("https://custom.idp.example.com/.well-known/openid-configuration");
  });

  it("should throw when provider is 'palantir' but stackUrl is missing", () => {
    expect(() => resolveOidcDiscoveryUrl({ provider: "palantir" })).toThrow(
      "OIDC provider 'palantir' requires stackUrl",
    );
  });

  it("should throw when provider is 'azure-ad' but tenantId is missing", () => {
    expect(() => resolveOidcDiscoveryUrl({ provider: "azure-ad" })).toThrow(
      "OIDC provider 'azure-ad' requires tenantId",
    );
  });

  it("should throw when provider is 'keycloak' but realm is missing", () => {
    expect(() =>
      resolveOidcDiscoveryUrl({
        provider: "keycloak",
        stackUrl: "https://keycloak.internal",
      }),
    ).toThrow("OIDC provider 'keycloak' requires realm");
  });

  it("should throw for unknown provider value", () => {
    expect(() => resolveOidcDiscoveryUrl({ provider: "unknown-idp" })).toThrow(
      "Unknown OIDC provider 'unknown-idp'",
    );
  });

  it("should throw when neither discoveryUrl nor provider is set", () => {
    expect(() => resolveOidcDiscoveryUrl({})).toThrow(
      "Either discoveryUrl or provider must be set",
    );
  });
});
