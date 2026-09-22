// ARMA API Hub — observability primitives.
//
// Redaction-safe logging and telemetry. The core guarantee: raw secrets,
// signatures, protected payloads, and credentials can NEVER reach a log line
// or telemetry span. This is enforced structurally by an allow-list of safe
// keys plus a deny-list of forbidden keys and registered secret values.

/** Keys that may appear in structured log/telemetry metadata. */
export const SAFE_METADATA_KEYS = new Set([
  'requestId',
  'receiptId',
  'eventId',
  'deliveryId',
  'serviceId',
  'partnerId',
  'orgRef',
  'tenantId',
  'capability',
  'operation',
  'entityRef',
  'errorClass',
  'errorCode',
  'attempt',
  'maxAttempts',
  'schemaVersion',
  'status',
  'outcome',
  'latencyMs',
  'retryCount',
  'stream',
  'sequence',
  'correlationId',
  'causationId',
  'keyId',
  'algorithm',
  'killSwitchEngaged',
]);

/** Keys that must NEVER appear in metadata (defense in depth). */
export const FORBIDDEN_METADATA_KEYS = new Set([
  'secret',
  'secretvalue',
  'token',
  'credential',
  'credentials',
  'password',
  'privatekey',
  'signingkey',
  'apikey',
  'authorization',
  'signature',
  'signaturevalue',
  'payload',
  'body',
  'content',
  'output',
  'prompt',
  'rawbody',
]);

const STRING_MAX = 256;

export interface RedactionOptions {
  /** Secret values that must never appear in any metadata value. */
  readonly secretValues?: readonly string[];
}

export interface RedactionResult {
  readonly safe: Record<string, string | number | boolean | null>;
  readonly droppedKeys: string[];
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Reduce an arbitrary metadata object to a safe, allow-listed, scalar-only
 * map. Forbidden keys are dropped; non-allow-listed keys are dropped; string
 * values are bounded; registered secret values are dropped.
 */
export function redactMetadata(
  input: Record<string, unknown> | undefined,
  options: RedactionOptions = {},
): RedactionResult {
  const safe: Record<string, string | number | boolean | null> = {};
  const droppedKeys: string[] = [];
  if (!input || typeof input !== 'object') return { safe, droppedKeys };

  const secrets = (options.secretValues ?? []).filter(
    (s) => typeof s === 'string' && s.length >= 8,
  );

  for (const [key, value] of Object.entries(input)) {
    const norm = normalizeKey(key);
    if (FORBIDDEN_METADATA_KEYS.has(norm) || !SAFE_METADATA_KEYS.has(key)) {
      droppedKeys.push(key);
      continue;
    }
    if (value === null) {
      safe[key] = null;
      continue;
    }
    if (typeof value === 'number') {
      safe[key] = Number.isFinite(value) ? value : null;
      continue;
    }
    if (typeof value === 'boolean') {
      safe[key] = value;
      continue;
    }
    if (typeof value === 'string') {
      if (secrets.some((s) => value.includes(s))) {
        droppedKeys.push(key);
        continue;
      }
      safe[key] = value.length > STRING_MAX ? value.slice(0, STRING_MAX) : value;
      continue;
    }
    droppedKeys.push(key);
  }
  return { safe, droppedKeys };
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  readonly level: LogLevel;
  readonly message: string;
  readonly at: number;
  readonly metadata: Record<string, string | number | boolean | null>;
}

export interface LoggerOptions extends RedactionOptions {
  readonly level?: LogLevel;
  readonly sink?: (record: LogRecord) => void;
  readonly now?: () => number;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** A redaction-safe structured logger. */
export class SafeLogger {
  private readonly level: LogLevel;
  private readonly sink: (record: LogRecord) => void;
  private readonly now: () => number;
  private readonly secretValues: readonly string[];

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? 'info';
    this.sink = options.sink ?? ((record) => console.warn(JSON.stringify(record)));
    this.now = options.now ?? Date.now;
    this.secretValues = options.secretValues ?? [];
  }

  private emit(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    const { safe } = redactMetadata(metadata, { secretValues: this.secretValues });
    this.sink({ level, message, at: this.now(), metadata: safe });
  }

  debug(message: string, metadata?: Record<string, unknown>): void {
    this.emit('debug', message, metadata);
  }
  info(message: string, metadata?: Record<string, unknown>): void {
    this.emit('info', message, metadata);
  }
  warn(message: string, metadata?: Record<string, unknown>): void {
    this.emit('warn', message, metadata);
  }
  error(message: string, metadata?: Record<string, unknown>): void {
    this.emit('error', message, metadata);
  }
}
