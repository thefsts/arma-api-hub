// Phase 9 — Hub-authoritative trace identity (PM correction C2).
//
// A client-supplied correlation id is never the authoritative trace identity.
// The Hub mints its own and binds it to the authenticated routing context.

import { describe, expect, it } from 'vitest';
import {
  InMemoryTraceBindingRegistry,
  assertTraceBinding,
  canonicalRoutingContext,
  hashRoutingContext,
  mintTraceIdentity,
  type RoutingContext,
  type TraceBinding,
} from '@arma/observability';

const NOW = 1_700_000_000_000;

function context(overrides: Partial<RoutingContext> = {}): RoutingContext {
  return {
    productId: 'arma-sentinel',
    tenantId: 'tenant-a',
    environment: 'PRODUCTION',
    hubRoutingIdentity: 'hub:prod',
    serviceId: 'svc-a',
    ...overrides,
  };
}

function deterministicMint(hex: string): () => string {
  return () => `trc_${hex.repeat(32).slice(0, 32)}`;
}

describe('canonical routing context', () => {
  it('serializes deterministically and hashes stably', () => {
    expect(canonicalRoutingContext(context())).toBe(
      'product:arma-sentinel|tenant:tenant-a|environment:PRODUCTION|identity:hub:prod|service:svc-a',
    );
    expect(hashRoutingContext(context())).toBe(hashRoutingContext(context()));
    expect(hashRoutingContext(context())).toHaveLength(64);
  });

  it('changes the hash when any routing dimension changes', () => {
    const base = hashRoutingContext(context());
    expect(hashRoutingContext(context({ tenantId: 'tenant-b' }))).not.toBe(base);
    expect(hashRoutingContext(context({ productId: 'other' }))).not.toBe(base);
    expect(hashRoutingContext(context({ environment: 'DEVELOPMENT' }))).not.toBe(base);
    expect(hashRoutingContext(context({ serviceId: 'svc-b' }))).not.toBe(base);
  });
});

describe('minting', () => {
  it('mints a Hub-owned trace and preserves the caller reference separately', () => {
    const registry = new InMemoryTraceBindingRegistry();
    const decision = mintTraceIdentity({
      routingContext: context(),
      callerCorrelationRef: 'req-12345678',
      now: NOW,
      registry,
      mint: deterministicMint('a'),
    });
    expect(decision.ok).toBe(true);
    expect(decision.binding?.mintedBy).toBe('HUB');
    expect(decision.binding?.traceId).toBe(`trc_${'a'.repeat(32)}`);
    expect(decision.binding?.callerCorrelationRef).toBe('req-12345678');
  });

  it('rejects a caller reference already bound to a different routing context', () => {
    const registry = new InMemoryTraceBindingRegistry();
    mintTraceIdentity({
      routingContext: context({ tenantId: 'tenant-a' }),
      callerCorrelationRef: 'req-shared',
      now: NOW,
      registry,
      mint: deterministicMint('a'),
    });
    const replay = mintTraceIdentity({
      routingContext: context({ tenantId: 'tenant-b' }),
      callerCorrelationRef: 'req-shared',
      now: NOW,
      registry,
      mint: deterministicMint('b'),
    });
    expect(replay.ok).toBe(false);
    expect(replay.reason).toBe('CALLER_REFERENCE_CONTEXT_MISMATCH');
    expect(replay.code).toBe('INTEGRITY_FAILED');
  });

  it('rejects a malformed minted id and a collision', () => {
    const registry = new InMemoryTraceBindingRegistry();
    const malformed = mintTraceIdentity({
      routingContext: context(),
      now: NOW,
      registry,
      mint: () => 'not-a-trace',
    });
    expect(malformed.reason).toBe('TRACE_ID_SHAPE_INVALID');

    mintTraceIdentity({
      routingContext: context(),
      now: NOW,
      registry,
      mint: deterministicMint('c'),
    });
    const collision = mintTraceIdentity({
      routingContext: context(),
      now: NOW,
      registry,
      mint: deterministicMint('c'),
    });
    expect(collision.reason).toBe('TRACE_ID_COLLISION');
  });
});

describe('asserting a presented trace', () => {
  it('accepts a trace minted for the exact routing context', () => {
    const registry = new InMemoryTraceBindingRegistry();
    const decision = mintTraceIdentity({
      routingContext: context(),
      callerCorrelationRef: 'req-12345678',
      now: NOW,
      registry,
      mint: deterministicMint('d'),
    });
    const traceId = decision.binding?.traceId ?? '';
    const result = assertTraceBinding({
      traceId,
      routingContext: context(),
      registry,
      callerCorrelationRef: 'req-12345678',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown trace id', () => {
    const registry = new InMemoryTraceBindingRegistry();
    const result = assertTraceBinding({
      traceId: `trc_${'e'.repeat(32)}`,
      routingContext: context(),
      registry,
    });
    expect(result.reason).toBe('TRACE_ID_UNKNOWN');
  });

  it('rejects a trace presented under a different tenant/product/environment', () => {
    const registry = new InMemoryTraceBindingRegistry();
    const decision = mintTraceIdentity({
      routingContext: context(),
      now: NOW,
      registry,
      mint: deterministicMint('f'),
    });
    const traceId = decision.binding?.traceId ?? '';
    for (const altered of [
      context({ tenantId: 'tenant-b' }),
      context({ productId: 'other-product' }),
      context({ environment: 'DEVELOPMENT' }),
    ]) {
      const result = assertTraceBinding({ traceId, routingContext: altered, registry });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('ROUTING_CONTEXT_MISMATCH');
    }
  });

  it('rejects a borrowed caller reference', () => {
    const registry = new InMemoryTraceBindingRegistry();
    const decision = mintTraceIdentity({
      routingContext: context(),
      callerCorrelationRef: 'req-owned',
      now: NOW,
      registry,
      mint: deterministicMint('1'),
    });
    const result = assertTraceBinding({
      traceId: decision.binding?.traceId ?? '',
      routingContext: context(),
      registry,
      callerCorrelationRef: 'req-borrowed',
    });
    expect(result.reason).toBe('CALLER_REFERENCE_MISMATCH');
  });

  it('rejects a trace that the registry does not attribute to the Hub', () => {
    const registry = new InMemoryTraceBindingRegistry();
    const traceId = `trc_${'2'.repeat(32)}`;
    registry.put({
      traceId,
      callerCorrelationRef: null,
      routingContextHash: hashRoutingContext(context()),
      mintedAt: NOW,
      mintedBy: 'CLIENT',
    } as unknown as TraceBinding);
    const result = assertTraceBinding({ traceId, routingContext: context(), registry });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('TRACE_NOT_HUB_MINTED');
  });

  it('rejects a malformed presented trace id', () => {
    const registry = new InMemoryTraceBindingRegistry();
    const result = assertTraceBinding({
      traceId: 'req-12345678',
      routingContext: context(),
      registry,
    });
    expect(result.reason).toBe('TRACE_ID_SHAPE_INVALID');
  });
});
