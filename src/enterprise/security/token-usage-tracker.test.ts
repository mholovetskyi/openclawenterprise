import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTokenUsageTracker } from "./guardrails-nvidia.js";

describe("createTokenUsageTracker: independent hourly/daily accumulators", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT wipe the daily counter on the hourly boundary", () => {
    const tracker = createTokenUsageTracker();
    tracker.addUsage("tenant:acme:daily", 4_000_000);
    expect(tracker.getUsage("tenant:acme:daily", "daily")).toBe(4_000_000);

    // Advance just past one hour — the hourly reset must not touch the daily bucket.
    vi.advanceTimersByTime(3_600_000 + 1000);
    tracker.addUsage("tenant:acme:daily", 1_500_000);

    // Daily accrues across the hour boundary; a 5M daily cap would now trigger.
    expect(tracker.getUsage("tenant:acme:daily", "daily")).toBe(5_500_000);
  });

  it("resets the daily counter only on the 24h boundary", () => {
    const tracker = createTokenUsageTracker();
    tracker.addUsage("tenant:acme:daily", 5_000_000);
    vi.advanceTimersByTime(86_400_000 + 1000);
    // Reading after a day has elapsed resets the daily bucket.
    expect(tracker.getUsage("tenant:acme:daily", "daily")).toBe(0);
  });

  it("resets the hourly counter on the 1h boundary", () => {
    const tracker = createTokenUsageTracker();
    tracker.addUsage("user:u1:hourly", 600_000);
    expect(tracker.getUsage("user:u1:hourly", "hourly")).toBe(600_000);
    vi.advanceTimersByTime(3_600_000 + 1000);
    expect(tracker.getUsage("user:u1:hourly", "hourly")).toBe(0);
  });
});
