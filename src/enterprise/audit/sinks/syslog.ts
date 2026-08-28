/**
 * Syslog RFC 5424 sink for audit events.
 *
 * Streams audit events to a syslog server over UDP or TCP.
 * Compatible with: Splunk Universal Forwarder, Elastic Logstash, Datadog Agent,
 *                  Sumo Logic, AWS CloudWatch, rsyslog, syslog-ng.
 *
 * Activation in config:
 *   enterprise:
 *     audit:
 *       sinks:
 *         - type: syslog
 *           host: splunk.internal
 *           port: 514
 *           protocol: udp     # or tcp
 *           facility: 1       # user-level messages
 *           appName: openclaw
 *
 * No external dependencies — pure Node.js dgram/net.
 */

import { createSocket, type Socket as UdpSocket } from "node:dgram";
import { createConnection, type Socket as TcpSocket } from "node:net";
import type { AuditEvent } from "../schema.js";

// ── RFC 5424 constants ─────────────────────────────────────────────────────────

const SEVERITY = {
  emergency: 0,
  alert: 1,
  critical: 2,
  error: 3,
  warning: 4,
  notice: 5,
  info: 6,
  debug: 7,
} as const;

type Severity = keyof typeof SEVERITY;

function facilityPriority(facility: number, severity: Severity): number {
  return facility * 8 + SEVERITY[severity];
}

const NILVALUE = "-";

function rfc5424(opts: {
  facility: number;
  severity: Severity;
  appName: string;
  procId?: string;
  msgId?: string;
  hostname?: string;
  timestamp?: string;
  structuredData?: string;
  message: string;
}): string {
  const pri = facilityPriority(opts.facility, opts.severity);
  const ts = opts.timestamp ?? new Date().toISOString();
  const host = opts.hostname ?? NILVALUE;
  const app = opts.appName || NILVALUE;
  const proc = opts.procId ?? String(process.pid);
  const msgId = opts.msgId ?? NILVALUE;
  const sd = opts.structuredData ?? NILVALUE;
  // RFC 5424 format: <PRI>VERSION SP TIMESTAMP SP HOSTNAME SP APP-NAME SP PROCID SP MSGID SP SD SP MSG
  return `<${pri}>1 ${ts} ${host} ${app} ${proc} ${msgId} ${sd} ${opts.message}`;
}

// ── Syslog sink ────────────────────────────────────────────────────────────────

export type SyslogSinkConfig = {
  host: string;
  port?: number;
  protocol?: "udp" | "tcp";
  facility?: number;
  severity?: Severity;
  appName?: string;
  hostname?: string;
};

export type AuditSink = {
  send(event: AuditEvent): Promise<void>;
  close(): Promise<void>;
};

/** Strip CR, LF, and other C0/DEL control characters so an attacker-influenced
 * field cannot inject a forged syslog line or record. */
function stripControl(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1F\x7F]/g, "");
}

/** RFC 5424 PARAM-VALUE escaping: backslash, double-quote, AND closing bracket
 * (a stray `]` would otherwise close the structured-data element early). Control
 * characters are stripped as defense in depth. */
function escapeSdValue(value: string): string {
  return stripControl(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/]/g, "\\]");
}

export function eventToSyslog(event: AuditEvent, opts: SyslogSinkConfig): string {
  const severity: Severity =
    event.outcome === "failure" ? "error" : event.outcome === "denied" ? "warning" : "info";

  // RFC 5424 structured data element
  const sdId = "openclaw@0"; // enterprise private structured data ID
  const fields: Record<string, string> = {
    id: event.id,
    actor: event.actor.id,
    action: event.action,
    category: event.category,
    outcome: event.outcome,
  };
  if (event.resource?.id) fields["resource"] = event.resource.id;
  if (event.actor.tenantId) fields["tenantId"] = event.actor.tenantId;
  if (event.durationMs !== undefined) fields["durationMs"] = String(event.durationMs);

  const sdParts = Object.entries(fields)
    .map(([k, v]) => `${k}="${escapeSdValue(v)}"`)
    .join(" ");

  return rfc5424({
    facility: opts.facility ?? 1,
    severity,
    appName: opts.appName ?? "openclaw",
    hostname: opts.hostname ?? undefined,
    timestamp: event.timestamp,
    msgId: event.id,
    structuredData: `[${sdId} ${sdParts}]`,
    // Strip control chars from interpolated fields so an embedded newline cannot
    // inject a whole forged record over the stream.
    message: `${stripControl(event.action)} outcome=${event.outcome} actor=${stripControl(event.actor.id)}`,
  });
}

export function createSyslogSink(config: SyslogSinkConfig): AuditSink {
  const port = config.port ?? 514;
  const protocol = config.protocol ?? "udp";

  if (protocol === "udp") {
    // ── UDP sink ──────────────────────────────────────────────────────────────
    const sock: UdpSocket = createSocket("udp4");

    return {
      async send(event: AuditEvent): Promise<void> {
        const msg = eventToSyslog(event, config);
        const buf = Buffer.from(msg, "utf8");
        await new Promise<void>((resolve, reject) => {
          sock.send(buf, 0, buf.length, port, config.host, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      },
      async close(): Promise<void> {
        await new Promise<void>((resolve) => sock.close(() => resolve()));
      },
    };
  }

  // ── TCP sink (with reconnect) ───────────────────────────────────────────────
  let socket: TcpSocket | null = null;
  let connecting = false;
  const queue: Array<{ data: Buffer; resolve: () => void; reject: (e: Error) => void }> = [];

  function connect() {
    if (connecting || socket?.readable) return;
    connecting = true;
    socket = createConnection({ host: config.host, port }, () => {
      connecting = false;
      drainQueue();
    });
    socket.on("error", () => {
      socket?.destroy();
      socket = null;
      connecting = false;
    });
    socket.on("close", () => {
      socket = null;
      connecting = false;
    });
  }

  function drainQueue() {
    while (queue.length > 0 && socket?.writable) {
      const item = queue.shift()!;
      socket.write(item.data, (err) => {
        if (err) item.reject(err instanceof Error ? err : new Error(String(err)));
        else item.resolve();
      });
    }
  }

  connect();

  return {
    async send(event: AuditEvent): Promise<void> {
      // RFC 6587 octet-counting framing ("<len> <msg>") instead of newline
      // framing, so an embedded newline cannot split one event into two records.
      const payload = eventToSyslog(event, config);
      const payloadBytes = Buffer.byteLength(payload, "utf8");
      const buf = Buffer.from(`${payloadBytes} ${payload}`, "utf8");

      if (socket?.writable) {
        await new Promise<void>((resolve, reject) => {
          socket!.write(buf, (err) => {
            if (err) reject(err instanceof Error ? err : new Error(String(err)));
            else resolve();
          });
        });
        return;
      }

      // Buffer until connected
      await new Promise<void>((resolve, reject) => {
        queue.push({ data: buf, resolve, reject });
        connect();
      });
    },

    async close(): Promise<void> {
      socket?.destroy();
      socket = null;
    },
  };
}

// ── Webhook sink (for generic HTTP log aggregators) ───────────────────────────

export type WebhookSinkConfig = {
  url: string;
  headers?: Record<string, string>;
  batchSize?: number;
  flushIntervalMs?: number;
};

export function createWebhookSink(config: WebhookSinkConfig): AuditSink {
  const batchSize = config.batchSize ?? 100;
  const flushMs = config.flushIntervalMs ?? 5_000;
  let batch: AuditEvent[] = [];
  let flushTimer: NodeJS.Timeout | null = null;

  async function flush(): Promise<void> {
    if (batch.length === 0) return;
    const toSend = batch.splice(0);
    try {
      await fetch(config.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...config.headers },
        body: JSON.stringify(toSend),
      });
    } catch {
      // Non-fatal: audit event delivery is best-effort for webhook sinks
    }
  }

  function scheduleFlush() {
    if (!flushTimer) {
      flushTimer = setTimeout(async () => {
        flushTimer = null;
        await flush();
      }, flushMs);
      flushTimer.unref?.();
    }
  }

  return {
    async send(event: AuditEvent): Promise<void> {
      batch.push(event);
      if (batch.length >= batchSize) {
        await flush();
      } else {
        scheduleFlush();
      }
    },

    async close(): Promise<void> {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      await flush();
    },
  };
}
