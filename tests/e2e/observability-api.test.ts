// End-to-end: the Phase 9 operational surface.
//
// These tests pin the honesty properties of the HTTP boundary:
//
//   * `/readyz` fails closed (503) when a mandatory dependency is unverifiable
//     or unavailable, and never claims readiness on UNKNOWN
//   * `/v1/health` speaks only the four-state operational vocabulary and carries
//     explicit `complianceClaim: 'NONE'` / `certificationClaim: 'NONE'`
//   * `/v1/metrics` is a bounded exposition with closed-enum labels and never
//     leaks tenant, product, or trace identifiers
//   * a successful `/v1/validate` returns a Hub-minted trace id
//
// No production connector is exercised.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, type DependencyProbe } from '@arma/api';
import { loadConfig } from '@arma/config';
import { signedRequest, TEST_KEY_ID, TEST_SECRET } from '../support/harness.js';

const NOW = 1_700_000_000_000;

function build(probes: readonly DependencyProbe[]) {
  const config = loadConfig({ API_HUB_ENV: 'development' });
  return buildApp({
    config,
    resolveSecret: (keyId) => (keyId === TEST_KEY_ID ? TEST_SECRET : null),
    telemetry: {
      productId: 'arma-sentinel',
      hubRoutingIdentity: 'hub:dev',
      probes,
      now: () => NOW,
    },
  });
}

describe('operational surface — healthy boundary', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = build([
      { name: 'core', mandatory: true, probe: () => ({ ok: true, observedAt: NOW }) },
      { name: 'webhook', mandatory: false, probe: () => ({ ok: true, observedAt: NOW }) },
    ]);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports AVAILABLE readiness with explicit non-claims', async () => {
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.state).toBe('AVAILABLE');
    expect(body.complianceClaim).toBe('NONE');
    expect(body.certificationClaim).toBe('NONE');
  });

  it('reports operational health without a compliance claim', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.state).toBe('AVAILABLE');
    expect(body.complianceClaim).toBe('NONE');
    expect(body.certificationClaim).toBe('NONE');
    expect(body.environment).toBe('DEVELOPMENT');
  });

  it('exposes bounded metrics with closed-enum labels only', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    const text = res.body;
    expect(text).toContain('arma_hub_operational_state');
    // No high-cardinality identifiers may appear as labels.
    expect(text).not.toMatch(/tenantId|tenant_id|productId|product_id|traceId|trace_id/);
    expect(text).not.toMatch(/trc_[0-9a-f]{32}/);
  });

  it('returns a Hub-minted trace id on a successful validation', async () => {
    const { envelope } = signedRequest({}, Date.now());
    const res = await app.inject({ method: 'POST', url: '/v1/validate', payload: envelope });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accepted).toBe(true);
    expect(body.traceId).toMatch(/^trc_[0-9a-f]{32}$/);
  });

  it('counts a denied request in the bounded metrics exposition', async () => {
    const { envelope } = signedRequest({ keyId: 'unknown-key-0001' });
    await app.inject({ method: 'POST', url: '/v1/validate', payload: envelope });
    const res = await app.inject({ method: 'GET', url: '/v1/metrics' });
    expect(res.body).toContain('arma_hub_transport_observations_total');
    expect(res.body).toContain('AUTHENTICATION_FAILED');
  });
});

describe('operational surface — fail-closed readiness', () => {
  it('returns 503 and UNKNOWN when a mandatory probe is stale', async () => {
    const app = build([
      { name: 'core', mandatory: true, probe: () => ({ ok: true, observedAt: NOW - 600_000 }) },
    ]);
    await app.ready();
    try {
      const res = await app.inject({ method: 'GET', url: '/readyz' });
      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.status).toBe('not_ready');
      expect(body.state).toBe('UNKNOWN');
      expect(body.state).not.toBe('AVAILABLE');
    } finally {
      await app.close();
    }
  });

  it('returns 503 and UNAVAILABLE when a mandatory probe fails', async () => {
    const app = build([
      { name: 'core', mandatory: true, probe: () => ({ ok: false, observedAt: NOW }) },
    ]);
    await app.ready();
    try {
      const res = await app.inject({ method: 'GET', url: '/readyz' });
      expect(res.statusCode).toBe(503);
      expect(res.json().state).toBe('UNAVAILABLE');
    } finally {
      await app.close();
    }
  });

  it('treats a throwing probe as unverifiable, not healthy', async () => {
    const app = build([
      {
        name: 'core',
        mandatory: true,
        probe: () => {
          throw new Error('probe exploded');
        },
      },
    ]);
    await app.ready();
    try {
      const res = await app.inject({ method: 'GET', url: '/readyz' });
      expect(res.statusCode).toBe(503);
      expect(res.json().state).toBe('UNKNOWN');
    } finally {
      await app.close();
    }
  });

  it('degrades rather than fails when only an optional probe fails', async () => {
    const app = build([
      { name: 'core', mandatory: true, probe: () => ({ ok: true, observedAt: NOW }) },
      { name: 'webhook', mandatory: false, probe: () => ({ ok: false, observedAt: NOW }) },
    ]);
    await app.ready();
    try {
      const res = await app.inject({ method: 'GET', url: '/readyz' });
      expect(res.statusCode).toBe(200);
      expect(res.json().state).toBe('DEGRADED');
    } finally {
      await app.close();
    }
  });
});
