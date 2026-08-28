/**
 * Reconnecting/buffering audit sink wrapper.
 *
 * When an external sink (Palantir, OCI) fails its startup connectivity check, it
 * must NOT degrade to a permanent silent no-op that black-holes every audit event
 * for the life of the process. Instead we return a sink that:
 *   - buffers events in a bounded in-memory queue,
 *   - periodically re-runs the connectivity check with backoff,
 *   - once connectivity is restored, builds the real ("live") sink and drains the
 *     buffered events into it,
 *   - exposes its degraded state via metrics (a health gauge + a one-shot
 *     "degraded" counter) so a dead sink is observable on the same dashboards the
 *     healthy path feeds, rather than detectable only via a lone boot-time stderr.
 */

import type { AuditEvent } from "../schema.js";
import type { AuditSink } from "./syslog.js";

export type ReconnectingSinkMetrics = {
  eventsTotal: { inc(labels?: Record<string, string>, value?: number): void };
  bufferSize: { set(labels: Record<string, string>, value: number): void };
};

export type ReconnectingSinkOptions = {
  /** Human-readable sink label used in metric labels and log lines. */
  label: string;
  /** Re-run the connectivity/health check. Resolves when healthy, rejects otherwise. */
  check: () => Promise<void>;
  /** Build the live sink once connectivity is confirmed. */
  makeLive: () => AuditSink;
  metrics: ReconnectingSinkMetrics;
  /** Max events retained while disconnected before the oldest are dropped. */
  maxBufferSize: number;
  /** Base retry interval in ms (grows with backoff up to a cap). */
  retryIntervalMs: number;
};

export function createReconnectingSink(opts: ReconnectingSinkOptions): AuditSink {
  const { label, check, makeLive, metrics, maxBufferSize, retryIntervalMs } = opts;
  const buffer: AuditEvent[] = [];
  let live: AuditSink | null = null;
  let closed = false;
  let attempt = 0;
  let timer: NodeJS.Timeout | null = null;

  // Observable degraded state: a one-shot counter increment plus a health gauge
  // pinned to 0 (down) while disconnected.
  metrics.eventsTotal.inc({ outcome: "degraded", sink: label }, 1);
  metrics.bufferSize.set({ sink: `${label}:up` }, 0);

  function scheduleReconnect(): void {
    if (closed || timer || live) return;
    const delay = Math.min(retryIntervalMs * Math.pow(2, attempt), 60_000);
    timer = setTimeout(async () => {
      timer = null;
      if (closed || live) return;
      attempt++;
      try {
        await check();
      } catch {
        scheduleReconnect();
        return;
      }
      // Connectivity restored — go live and drain the buffer.
      const liveSink = makeLive();
      live = liveSink;
      metrics.bufferSize.set({ sink: `${label}:up` }, 1);
      const drained = buffer.splice(0);
      metrics.bufferSize.set({ sink: label }, 0);
      for (const event of drained) {
        try {
          await liveSink.send(event);
        } catch (err) {
          process.stderr.write(`[${label}] Failed to drain buffered event: ${String(err)}\n`);
        }
      }
    }, delay);
    timer.unref?.();
  }

  scheduleReconnect();

  return {
    async send(event: AuditEvent): Promise<void> {
      if (live) {
        await live.send(event);
        return;
      }
      if (buffer.length >= maxBufferSize) {
        buffer.shift();
        metrics.eventsTotal.inc({ outcome: "dropped", sink: label }, 1);
        process.stderr.write(
          `[${label}] Sink disconnected and buffer full (${maxBufferSize}); dropping oldest event\n`,
        );
      }
      buffer.push(event);
      metrics.bufferSize.set({ sink: label }, buffer.length);
      scheduleReconnect();
    },

    async close(): Promise<void> {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (live) {
        await live.close();
      }
    },
  };
}
