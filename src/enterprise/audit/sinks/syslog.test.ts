import { describe, it, expect } from "vitest";
import type { AuditEvent } from "../schema.js";
import { eventToSyslog, type SyslogSinkConfig } from "./syslog.js";

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: "EVT_1",
    timestamp: "2026-03-10T12:00:00.000Z",
    version: 1,
    actor: { type: "user", id: "user-1" },
    action: "auth.login.success",
    category: "auth",
    outcome: "success",
    hash: "abc",
    ...overrides,
  };
}

const cfg: SyslogSinkConfig = { host: "siem.internal", appName: "openclaw" };

describe("eventToSyslog structured-data escaping", () => {
  it("escapes a closing bracket so the SD element cannot be closed early", () => {
    const line = eventToSyslog(makeEvent({ actor: { type: "user", id: "a]b" } }), cfg);
    expect(line).toContain('actor="a\\]b"');
    // Within the structured-data element the only unescaped `]` is the
    // terminator — the injected bracket must not close the element early.
    const sd = line.slice(line.indexOf("[openclaw@0"));
    const sdElement = sd.slice(0, sd.indexOf("] ") + 1); // up to and incl. terminator
    const unescaped = sdElement.match(/(?<!\\)]/g) ?? [];
    expect(unescaped.length).toBe(1);
  });

  it("escapes backslash and double-quote in SD values", () => {
    const line = eventToSyslog(makeEvent({ actor: { type: "user", id: 'a"b\\c' } }), cfg);
    expect(line).toContain('actor="a\\"b\\\\c"');
  });

  it("strips CR/LF from SD values so a newline cannot inject a record", () => {
    const line = eventToSyslog(
      makeEvent({ actor: { type: "user", id: "evil\n<34>1 forged" } }),
      cfg,
    );
    expect(line).not.toContain("\n");
    expect(line).toContain('actor="evil<34>1 forged"');
  });

  it("strips control characters from the interpolated MSG (action/actor)", () => {
    const line = eventToSyslog(
      makeEvent({ action: "a\nb\r", actor: { type: "user", id: "x\ny" } }),
      cfg,
    );
    // No embedded newline/CR survives into the framed message.
    expect(line).not.toMatch(/[\n\r]/);
    expect(line).toContain("actor=xy");
  });
});
