/**
 * BaseBatchedAuditSink — abstract base class that handles batching, retry,
 * and buffer management so concrete sinks only implement `flushBatch()`.
 *
 * Extracts the duplicated batching/retry pattern found in palantir, webhook,
 * and syslog sinks into a single reusable class.
 */

import type { AuditEvent, AuditSink, HealthCheckResult, HealthCheckable } from "./interfaces.js";
import type { PluginLogger } from "./lifecycle.js";

export type BatchedAuditSinkOptions = {
  /** Maximum events per batch (default: 100) */
  batchSize?: number;
  /** Flush interval in milliseconds (default: 5000) */
  flushIntervalMs?: number;
  /** Number of retry attempts on flush failure (default: 3) */
  retryAttempts?: number;
  /** Base retry backoff in ms, doubled each attempt (default: 1000) */
  retryBackoffMs?: number;
  /** Maximum buffer size before dropping oldest events (default: 10000) */
  maxBufferSize?: number;
};

export abstract class BaseBatchedAuditSink implements AuditSink, HealthCheckable {
  protected readonly batchSize: number;
  protected readonly flushIntervalMs: number;
  protected readonly retryAttempts: number;
  protected readonly retryBackoffMs: number;
  protected readonly maxBufferSize: number;
  protected readonly logger: PluginLogger;

  private buffer: AuditEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private totalSent = 0;
  private totalDropped = 0;
  private totalErrors = 0;
  private lastFlushMs = 0;
  private closed = false;

  constructor(logger: PluginLogger, opts: BatchedAuditSinkOptions = {}) {
    this.batchSize = opts.batchSize ?? 100;
    this.flushIntervalMs = opts.flushIntervalMs ?? 5_000;
    this.retryAttempts = opts.retryAttempts ?? 3;
    this.retryBackoffMs = opts.retryBackoffMs ?? 1_000;
    this.maxBufferSize = opts.maxBufferSize ?? 10_000;
    this.logger = logger;
  }

  /**
   * Subclasses implement this to actually send a batch of events.
   * Throw on failure — retry logic is handled by the base class.
   */
  protected abstract flushBatch(events: AuditEvent[]): Promise<void>;

  async send(event: AuditEvent): Promise<void> {
    if (this.closed) {
      return;
    }

    if (this.buffer.length >= this.maxBufferSize) {
      this.buffer.shift();
      this.totalDropped++;
      this.logger.warn(`Buffer full (${this.maxBufferSize}), dropping oldest event`);
    }

    this.buffer.push(event);

    if (this.buffer.length >= this.batchSize) {
      await this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    // Drain remaining buffer
    while (this.buffer.length > 0) {
      await this.flush();
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return {
      status: this.closed ? "unhealthy" : this.totalErrors > 0 ? "degraded" : "healthy",
      details: {
        bufferSize: this.buffer.length,
        totalSent: this.totalSent,
        totalDropped: this.totalDropped,
        totalErrors: this.totalErrors,
        lastFlushMs: this.lastFlushMs,
      },
    };
  }

  /** Current number of buffered events */
  get bufferedCount(): number {
    return this.buffer.length;
  }

  private scheduleFlush(): void {
    if (!this.flushTimer && !this.closed) {
      this.flushTimer = setTimeout(async () => {
        this.flushTimer = null;
        await this.flush();
      }, this.flushIntervalMs);
      // Unref so it doesn't keep the process alive
      if (typeof this.flushTimer === "object" && "unref" in this.flushTimer) {
        this.flushTimer.unref();
      }
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0 || this.flushing) {
      return;
    }
    this.flushing = true;

    const batch = this.buffer.splice(0, this.batchSize);
    const startTime = Date.now();
    let lastErr: Error | undefined;

    for (let attempt = 0; attempt <= this.retryAttempts; attempt++) {
      try {
        await this.flushBatch(batch);
        this.totalSent += batch.length;
        this.lastFlushMs = Date.now() - startTime;
        this.flushing = false;
        return;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.retryAttempts) {
          const delay = this.retryBackoffMs * Math.pow(2, attempt);
          await new Promise<void>((r) => setTimeout(r, delay));
        }
      }
    }

    // All retries exhausted
    this.totalErrors += batch.length;
    this.logger.error(
      `Failed to flush ${batch.length} events after ${this.retryAttempts + 1} attempts: ${lastErr?.message}`,
    );
    this.flushing = false;
  }
}
