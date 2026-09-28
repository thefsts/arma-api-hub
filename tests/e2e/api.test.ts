// End-to-end: the service-facing API validates signed envelopes and reports
// health. No production connectors are exercised.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '@arma/api';
import { loadConfig } from '@arma/config';
import { signedRequest, TEST_KEY_ID, TEST_SECRET } from '../support/harness.js';

describe('service-facing API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const config = loadConfig({ API_HUB_ENV: 'development' });
    app = buildApp({
      config,
      resolveSecret: (keyId) => (keyId === TEST_KEY_ID ? TEST_SECRET : null),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports liveness', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('reports readiness with fail-closed delivery defaults', async () => {
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.outboundDeliveryDisabled).toBe(true);
  });

  it('accepts a valid signed envelope', async () => {
    const { envelope } = signedRequest({}, Date.now());
    const res = await app.inject({ method: 'POST', url: '/v1/validate', payload: envelope });
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(true);
  });

  it('rejects an envelope missing signature metadata', async () => {
    const { envelope } = signedRequest();
    const { signature: _signature, ...withoutSignature } = envelope;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/validate',
      payload: withoutSignature,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('ENVELOPE_INVALID');
  });

  it('rejects an envelope signed with an unknown key', async () => {
    const { envelope } = signedRequest({ keyId: 'unknown-key-0001' });
    const res = await app.inject({ method: 'POST', url: '/v1/validate', payload: envelope });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('CREDENTIAL_UNKNOWN');
  });

  it('rejects an envelope with a tampered signature', async () => {
    const { envelope } = signedRequest({}, Date.now());
    const tampered = { ...envelope, signature: { ...envelope.signature, value: 'f'.repeat(64) } };
    const res = await app.inject({ method: 'POST', url: '/v1/validate', payload: tampered });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('SIGNATURE_SIGNATURE_MISMATCH');
  });
});
