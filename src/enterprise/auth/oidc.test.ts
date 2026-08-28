import { createSign, generateKeyPairSync, createPublicKey } from "node:crypto";
import { describe, it, expect, vi, afterEach } from "vitest";
import { verifyIdToken } from "./oidc.js";

const b64url = (o: unknown): string =>
  Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");

function makeUnsignedIdToken(header: Record<string, unknown>, payload: Record<string, unknown>) {
  return `${b64url(header)}.${b64url(payload)}`;
}

const now = Math.floor(Date.now() / 1000);
const basePayload = {
  sub: "user-1",
  iss: "https://idp.example.com",
  aud: "client-123",
  exp: now + 300,
  iat: now,
  email: "u@example.com",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("verifyIdToken — algorithm allowlist (fail closed)", () => {
  it("rejects alg:none without returning a payload", async () => {
    // A malicious alg:none token can carry a bogus non-empty signature segment.
    const token = makeUnsignedIdToken({ alg: "none", typ: "JWT" }, basePayload) + ".AAAA";
    await expect(
      verifyIdToken(token, "https://idp.example.com/jwks-none", basePayload.iss, basePayload.aud),
    ).rejects.toThrow(/Unsupported or insecure ID token alg/);
  });

  it("rejects an alg:none token with an empty signature (malformed)", async () => {
    const token = makeUnsignedIdToken({ alg: "none", typ: "JWT" }, basePayload) + ".";
    await expect(
      verifyIdToken(token, "https://idp.example.com/jwks-none2", basePayload.iss, basePayload.aud),
    ).rejects.toThrow();
  });

  it("rejects HS256 (symmetric confusion) without returning a payload", async () => {
    const token = makeUnsignedIdToken({ alg: "HS256", typ: "JWT" }, basePayload) + ".sig";
    await expect(
      verifyIdToken(token, "https://idp.example.com/jwks-hs", basePayload.iss, basePayload.aud),
    ).rejects.toThrow(/Unsupported or insecure ID token alg/);
  });

  it("rejects an alg not advertised by the IdP", async () => {
    const token = makeUnsignedIdToken({ alg: "RS512", typ: "JWT" }, basePayload) + ".sig";
    await expect(
      verifyIdToken(
        token,
        "https://idp.example.com/jwks-adv",
        basePayload.iss,
        basePayload.aud,
        ["RS256"], // IdP only advertises RS256
      ),
    ).rejects.toThrow(/not advertised/);
  });

  it("rejects a token with no alg header", async () => {
    const token = makeUnsignedIdToken({ typ: "JWT" }, basePayload) + ".sig";
    await expect(
      verifyIdToken(token, "https://idp.example.com/jwks-noalg", basePayload.iss, basePayload.aud),
    ).rejects.toThrow(/missing alg/);
  });
});

describe("verifyIdToken — RSA signature verification (bare n/e JWKS)", () => {
  function signRs256(payload: Record<string, unknown>, kid: string, privateKey: string): string {
    const header = { alg: "RS256", typ: "JWT", kid };
    const signingInput = `${b64url(header)}.${b64url(payload)}`;
    const sig = createSign("RSA-SHA256")
      .update(signingInput)
      .sign(privateKey)
      .toString("base64url");
    return `${signingInput}.${sig}`;
  }

  it("verifies a genuine RS256 token against a bare-key (n/e) JWKS", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    // Bare JWK (no x5c) — the path that used to throw before the fix.
    const jwk = createPublicKey(publicKey).export({ format: "jwk" });
    jwk.kid = "key-1";
    jwk.use = "sig";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ keys: [jwk] }) })),
    );

    const token = signRs256(basePayload, "key-1", privateKey);
    const claims = await verifyIdToken(
      token,
      "https://idp.example.com/jwks-rsa-ok",
      basePayload.iss,
      basePayload.aud,
    );
    expect(claims["sub"]).toBe("user-1");
    expect(claims["email"]).toBe("u@example.com");
  });

  it("rejects a token whose signature does not match the JWKS key", async () => {
    const pair1 = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const pair2 = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    // JWKS publishes pair2's public key, but token is signed with pair1's private key.
    const jwk = createPublicKey(pair2.publicKey).export({ format: "jwk" });
    jwk.kid = "key-1";
    jwk.use = "sig";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ keys: [jwk] }) })),
    );

    const token = signRs256(basePayload, "key-1", pair1.privateKey);
    await expect(
      verifyIdToken(
        token,
        "https://idp.example.com/jwks-rsa-bad",
        basePayload.iss,
        basePayload.aud,
      ),
    ).rejects.toThrow(/signature verification failed/);
  });

  it("rejects a token whose issuer does not match", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const jwk = createPublicKey(publicKey).export({ format: "jwk" });
    jwk.kid = "key-1";
    jwk.use = "sig";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ keys: [jwk] }) })),
    );
    const token = signRs256(basePayload, "key-1", privateKey);
    await expect(
      verifyIdToken(
        token,
        "https://idp.example.com/jwks-rsa-iss",
        "https://attacker.example.com",
        basePayload.aud,
      ),
    ).rejects.toThrow(/issuer mismatch/);
  });
});

describe("verifyIdToken — EC signature verification", () => {
  it("verifies a genuine ES256 token", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const jwk = createPublicKey(publicKey).export({ format: "jwk" });
    jwk.kid = "ec-1";
    jwk.use = "sig";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ keys: [jwk] }) })),
    );

    const header = { alg: "ES256", typ: "JWT", kid: "ec-1" };
    const signingInput = `${b64url(header)}.${b64url(basePayload)}`;
    // JWS ECDSA signatures are raw r||s (IEEE P1363).
    const sig = createSign("SHA256")
      .update(signingInput)
      .sign({ key: privateKey, dsaEncoding: "ieee-p1363" })
      .toString("base64url");
    const token = `${signingInput}.${sig}`;

    const claims = await verifyIdToken(
      token,
      "https://idp.example.com/jwks-ec-ok",
      basePayload.iss,
      basePayload.aud,
    );
    expect(claims["sub"]).toBe("user-1");
  });
});
