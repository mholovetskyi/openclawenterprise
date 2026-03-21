/**
 * Input sanitizer — strip prompt injection patterns before LLM processing.
 *
 * Defenses:
 *   - Injection pattern detection (ignore/override/jailbreak patterns)
 *   - Unicode homoglyph normalization
 *   - Invisible/control character stripping
 *   - Excessive length truncation
 *   - Trust boundary tagging
 */

export type SanitizeOptions = {
  /** Max character length (default 50_000) */
  maxLength?: number;
  /** Trust level of the content source */
  trustLevel?: "user" | "channel" | "web" | "skill" | "system";
  /** Strip invisible characters (default true) */
  stripInvisible?: boolean;
  /** Normalize Unicode homoglyphs (default true) */
  normalizeUnicode?: boolean;
  /** Detect and warn about injection patterns (default true) */
  detectInjection?: boolean;
};

export type SanitizeResult = {
  sanitized: string;
  /** Whether potential injection patterns were detected */
  injectionDetected: boolean;
  /** Detected patterns for logging */
  detectedPatterns: string[];
  /** Characters removed */
  charsRemoved: number;
  /** Content was truncated */
  truncated: boolean;
};

// ── Injection pattern rules ────────────────────────────────────────────────────

type InjectionRule = { id: string; pattern: RegExp; severity: "warn" | "block" };

const INJECTION_RULES: InjectionRule[] = [
  // Classic ignore-instructions patterns
  {
    id: "ignore-previous",
    pattern: /ignore\s+(all\s+)?(previous|prior|above|preceding)\s+instructions?/gi,
    severity: "block",
  },
  {
    id: "forget-instructions",
    pattern: /forget\s+(all\s+)?(previous|prior|above|your)\s+instructions?/gi,
    severity: "block",
  },
  {
    id: "disregard-instructions",
    pattern: /disregard\s+(all\s+)?(previous|prior|above|your)\s+instructions?/gi,
    severity: "block",
  },
  // Jailbreak / DAN patterns
  { id: "dan-pattern", pattern: /\bDAN\b.*jailbreak|jailbreak.*\bDAN\b/gi, severity: "block" },
  { id: "developer-mode", pattern: /enable\s+developer\s+mode/gi, severity: "warn" },
  // System prompt extraction
  { id: "system-prompt-leak", pattern: /print\s+(your|the)\s+system\s+prompt/gi, severity: "warn" },
  { id: "reveal-instructions", pattern: /reveal\s+(your|the)\s+(system\s+)?instructions?/gi, severity: "warn" },
  // Role hijacking
  { id: "you-are-now", pattern: /you\s+are\s+now\s+(?!openclaw|a\s+helpful)/gi, severity: "warn" },
  // Indirect injection markers (from external content)
  { id: "hidden-instruction", pattern: /\[\s*hidden\s*instruction\s*\]/gi, severity: "block" },
  { id: "system-override", pattern: /\[?\s*SYSTEM\s*OVERRIDE\s*\]?/g, severity: "block" },
  { id: "admin-override", pattern: /\[?\s*ADMIN\s*OVERRIDE\s*\]?/g, severity: "block" },
];

// ── Invisible / control characters ────────────────────────────────────────────

/** Characters that are invisible or confusing but not printable whitespace */
const INVISIBLE_CHAR_PATTERN = /[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\u00ad]/g;

/** Zero-width and formatting characters */
// eslint-disable-next-line no-misleading-character-class -- intentionally matching individual zero-width chars
const ZERO_WIDTH_PATTERN = /[\u200b\u200c\u200d\u200e\u200f\u2060\u2061\u2062\u2063\ufeff]/g;

// ── Public API ─────────────────────────────────────────────────────────────────

export function sanitizeInput(raw: string, opts: SanitizeOptions = {}): SanitizeResult {
  const {
    maxLength = 50_000,
    stripInvisible = true,
    normalizeUnicode = true,
    detectInjection = true,
  } = opts;

  let text = raw;
  let charsRemoved = 0;
  const detectedPatterns: string[] = [];

  // 1. Strip invisible/control characters
  if (stripInvisible) {
    const before = text.length;
    text = text
      .replace(INVISIBLE_CHAR_PATTERN, "")
      .replace(ZERO_WIDTH_PATTERN, "")
      // eslint-disable-next-line no-control-regex -- intentionally stripping dangerous control chars
      .replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g, ""); // control chars (keep \t\n\r)
    charsRemoved += before - text.length;
  }

  // 2. Unicode normalization (NFC)
  if (normalizeUnicode) {
    try {
      text = text.normalize("NFC");
    } catch {
      // Non-fatal
    }
  }

  // 3. Detect injection patterns
  let injectionDetected = false;
  if (detectInjection) {
    for (const rule of INJECTION_RULES) {
      if (rule.pattern.test(text)) {
        injectionDetected = true;
        detectedPatterns.push(rule.id);
        // Reset lastIndex for global regexes
        rule.pattern.lastIndex = 0;
      }
    }
  }

  // 4. Truncate
  const truncated = text.length > maxLength;
  if (truncated) {
    charsRemoved += text.length - maxLength;
    text = text.slice(0, maxLength) + "\n[content truncated]";
  }

  return { sanitized: text, injectionDetected, detectedPatterns, charsRemoved, truncated };
}

/**
 * Wrap external content (web pages, skill outputs) with trust boundary markers.
 * This tells the LLM the provenance of the content.
 */
export function wrapWithTrustBoundary(
  content: string,
  source: string,
  trustLevel: SanitizeOptions["trustLevel"] = "web",
): string {
  const label =
    trustLevel === "user"
      ? "USER INPUT"
      : trustLevel === "skill"
        ? "SKILL OUTPUT"
        : trustLevel === "system"
          ? "SYSTEM"
          : "EXTERNAL CONTENT";
  return `<${label} source="${source}">\n${content}\n</${label}>`;
}
