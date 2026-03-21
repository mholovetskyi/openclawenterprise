/**
 * TOTP-based Multi-Factor Authentication.
 *
 * Uses RFC 6238 TOTP (Time-based One-Time Password) — compatible with
 * Google Authenticator, Authy, 1Password, Bitwarden, and any TOTP app.
 *
 * No external dependencies — pure Node.js crypto.
 */

import { createHmac, randomBytes } from "node:crypto";

// ── Base32 ────────────────────────────────────────────────────────────────────

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf: Buffer): string {
  let result = "";
  let bits = 0;
  let value = 0;
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += BASE32_CHARS[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    result += BASE32_CHARS[(value << (5 - bits)) & 0x1f];
  }
  return result;
}

function base32Decode(encoded: string): Buffer {
  const input = encoded.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of input) {
    const idx = BASE32_CHARS.indexOf(char);
    if (idx === -1) {continue;}
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// ── HOTP (HMAC-based OTP) ─────────────────────────────────────────────────────

function hotp(secret: string, counter: bigint, digits = 6): string {
  const key = base32Decode(secret);
  // Counter as 8-byte big-endian
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(counter);
  const hmac = createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    (((hmac[offset]! & 0x7f) << 24) |
      ((hmac[offset + 1]! & 0xff) << 16) |
      ((hmac[offset + 2]! & 0xff) << 8) |
      (hmac[offset + 3]! & 0xff)) %
    Math.pow(10, digits);
  return String(code).padStart(digits, "0");
}

// ── TOTP (Time-based OTP) ─────────────────────────────────────────────────────

const TOTP_STEP_SEC = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1; // accept ±1 step to handle clock skew

function totpAt(secret: string, timestampSec: number): string {
  const counter = BigInt(Math.floor(timestampSec / TOTP_STEP_SEC));
  return hotp(secret, counter, TOTP_DIGITS);
}

// ── Public API ─────────────────────────────────────────────────────────────────

export class MfaService {
  /**
   * Generate a new TOTP enrollment for a user.
   * Returns the base32 secret (store encrypted) and an otpauth:// URI for QR rendering.
   */
  static generateEnrollment(
    userId: string,
    userEmail?: string,
    issuer = "OpenClaw Enterprise",
  ): { secret: string; otpauthUri: string } {
    // 20 bytes = 160 bits = strong TOTP secret
    const secret = base32Encode(randomBytes(20));
    const account = encodeURIComponent(userEmail ?? userId);
    const iss = encodeURIComponent(issuer);
    const otpauthUri =
      `otpauth://totp/${iss}:${account}?secret=${secret}&issuer=${iss}&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SEC}`;
    return { secret, otpauthUri };
  }

  /**
   * Verify a 6-digit TOTP code.
   * Accepts codes within ±TOTP_WINDOW steps (handles clock skew up to 30s).
   */
  static verify(secret: string, code: string, nowSec?: number): boolean {
    const now = nowSec ?? Math.floor(Date.now() / 1000);
    for (let i = -TOTP_WINDOW; i <= TOTP_WINDOW; i++) {
      if (totpAt(secret, now + i * TOTP_STEP_SEC) === code) {return true;}
    }
    return false;
  }

  /**
   * Generate a current TOTP code (for testing / debugging only).
   */
  static generate(secret: string): string {
    return totpAt(secret, Math.floor(Date.now() / 1000));
  }
}
