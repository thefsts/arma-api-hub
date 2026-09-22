// Scenario coverage: log redaction. Raw secrets, signatures, credentials, and
// protected payloads must never reach a log line.

import { describe, expect, it } from 'vitest';
import { redactMetadata, SafeLogger, type LogRecord } from '@arma/observability';

describe('redaction-safe logging', () => {
  it('SCENARIO 14: drops forbidden keys and non-allow-listed keys', () => {
    const { safe, droppedKeys } = redactMetadata({
      requestId: 'req-00000001',
      serviceId: 'arma-sentinel',
      secret: 'super-secret-value',
      token: 'bearer-abc',
      payload: { anything: true },
      signature: 'deadbeef',
      randomField: 'nope',
    });
    expect(safe.requestId).toBe('req-00000001');
    expect(safe.serviceId).toBe('arma-sentinel');
    expect(safe).not.toHaveProperty('secret');
    expect(safe).not.toHaveProperty('token');
    expect(safe).not.toHaveProperty('payload');
    expect(safe).not.toHaveProperty('signature');
    expect(safe).not.toHaveProperty('randomField');
    expect(droppedKeys).toEqual(
      expect.arrayContaining(['secret', 'token', 'payload', 'signature', 'randomField']),
    );
  });

  it('SCENARIO 14: drops any value containing a registered secret', () => {
    const secretValue = 'test-only-placeholder-secret-0000000001';
    const { safe } = redactMetadata(
      { requestId: `prefix-${secretValue}-suffix`, serviceId: 'arma-sentinel' },
      { secretValues: [secretValue] },
    );
    expect(safe).not.toHaveProperty('requestId');
    expect(safe.serviceId).toBe('arma-sentinel');
  });

  it('SCENARIO 14: SafeLogger never emits forbidden keys or secret values', () => {
    const records: LogRecord[] = [];
    const secretValue = 'test-only-placeholder-secret-0000000001';
    const logger = new SafeLogger({
      level: 'debug',
      sink: (record) => records.push(record),
      now: () => 1_700_000_000_000,
      secretValues: [secretValue],
    });
    logger.info('request.accepted', {
      requestId: 'req-00000001',
      secret: secretValue,
      token: secretValue,
      payload: { raw: secretValue },
      serviceId: 'arma-sentinel',
    });
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record).toBeDefined();
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain(secretValue);
    expect(record?.metadata).not.toHaveProperty('secret');
    expect(record?.metadata).not.toHaveProperty('token');
    expect(record?.metadata).not.toHaveProperty('payload');
    expect(record?.metadata.serviceId).toBe('arma-sentinel');
  });

  it('bounds long string values', () => {
    const { safe } = redactMetadata({ requestId: 'x'.repeat(1000) });
    expect(typeof safe.requestId).toBe('string');
    expect((safe.requestId as string).length).toBeLessThanOrEqual(256);
  });
});
