// ARMA API Hub — authoritative trace identity.
//
// PM CORRECTION C2 (locked): a client-supplied correlation ID is NOT the
// authoritative Hub trace identity. The Hub mints and binds its own trace
// identity from the authenticated routing context, and preserves the caller's
// reference separately as `callerCorrelationRef`.
//
// Consequences:
//   * Correlation forgery fails closed. A traceId the Hub did not mint for this
//     exact routing context is rejected with INTEGRITY_FAILED.
//   * Cross-tenant / cross-product / cross-environment trace collision fails
//     closed by construction: the routing-context hash is part of the binding.
//   * A caller reference replayed under a different routing context is
//     rejected, so a caller cannot use a borrowed reference to read or join
//     another tenant's trace.
//
// This module is pure: `now` and the nonce are supplied by the caller so the
// behaviour is deterministic and fully unit-testable.

import { createHash, randomBytes } from 'node:crypto';
import { TRACE_ID_PATTERN, type Environment } from './telemetry.js';

/** The authenticated routing context the Hub has already verified. */
export interface RoutingContext {
  readonly productId: string;
  readonly tenantId: string;
  readonly environment: Environment;
  readonly hubRoutingIdentity: string;
  readonly serviceId?: string;
}

export interface TraceBinding {
  /** Hub-minted authoritative identity. Never client-supplied. */
  readonly traceId: string;
  /** Caller reference preserved for interop. Never authoritative. */
  readonly callerCorrelationRef: string | null;
  /** SHA-256 over the canonical routing context. */
  readonly routingContextHash: string;
  readonly mintedAt: number;
  readonly mintedBy: 'HUB';
}

export type TraceRejectionCode = 'INTEGRITY_FAILED';

export interface TraceDecision {
  readonly ok: boolean;
  readonly binding: TraceBinding | null;
  readonly code: TraceRejectionCode | null;
  readonly reason: string | null;
}

/** Deterministic canonical serialization of the routing context. */
export function canonicalRoutingContext(context: RoutingContext): string {
  return [
    `product:${context.productId}`,
    `tenant:${context.tenantId}`,
    `environment:${context.environment}`,
    `identity:${context.hubRoutingIdentity}`,
    `service:${context.serviceId ?? ''}`,
  ].join('|');
}

export function hashRoutingContext(context: RoutingContext): string {
  return createHash('sha256').update(canonicalRoutingContext(context), 'utf8').digest('hex');
}

/** Mint an opaque, Hub-owned trace identifier. */
export function mintTraceId(): string {
  return `trc_${randomBytes(16).toString('hex')}`;
}

/**
 * The minimal registry the trace authority needs. Implementations may be
 * in-memory (tests) or backed by the transportObservations table.
 */
export interface TraceBindingRegistry {
  get(traceId: string): TraceBinding | undefined;
  put(binding: TraceBinding): void;
  /** True when this caller reference is already bound to a different context. */
  callerRefContext(callerCorrelationRef: string): string | undefined;
  bindCallerRef(callerCorrelationRef: string, routingContextHash: string): void;
}

/** A simple, deterministic in-memory registry. */
export class InMemoryTraceBindingRegistry implements TraceBindingRegistry {
  private readonly bindings = new Map<string, TraceBinding>();
  private readonly callerRefs = new Map<string, string>();

  get(traceId: string): TraceBinding | undefined {
    return this.bindings.get(traceId);
  }

  put(binding: TraceBinding): void {
    this.bindings.set(binding.traceId, binding);
  }

  callerRefContext(callerCorrelationRef: string): string | undefined {
    return this.callerRefs.get(callerCorrelationRef);
  }

  bindCallerRef(callerCorrelationRef: string, routingContextHash: string): void {
    this.callerRefs.set(callerCorrelationRef, routingContextHash);
  }
}

export interface MintTraceInput {
  readonly routingContext: RoutingContext;
  readonly callerCorrelationRef?: string | null;
  readonly now: number;
  readonly registry: TraceBindingRegistry;
  /** Injectable for deterministic tests. Defaults to `mintTraceId`. */
  readonly mint?: () => string;
}

/**
 * Mint and bind a new authoritative trace identity for an authenticated
 * routing context. Fails closed if the caller reference is already bound to a
 * different routing context (cross-tenant/product replay).
 */
export function mintTraceIdentity(input: MintTraceInput): TraceDecision {
  const contextHash = hashRoutingContext(input.routingContext);
  const callerRef =
    typeof input.callerCorrelationRef === 'string' && input.callerCorrelationRef.length > 0
      ? input.callerCorrelationRef
      : null;

  if (callerRef !== null) {
    const existing = input.registry.callerRefContext(callerRef);
    if (existing !== undefined && existing !== contextHash) {
      return {
        ok: false,
        binding: null,
        code: 'INTEGRITY_FAILED',
        reason: 'CALLER_REFERENCE_CONTEXT_MISMATCH',
      };
    }
  }

  const traceId = (input.mint ?? mintTraceId)();
  if (!TRACE_ID_PATTERN.test(traceId)) {
    return { ok: false, binding: null, code: 'INTEGRITY_FAILED', reason: 'TRACE_ID_SHAPE_INVALID' };
  }
  if (input.registry.get(traceId) !== undefined) {
    return { ok: false, binding: null, code: 'INTEGRITY_FAILED', reason: 'TRACE_ID_COLLISION' };
  }

  const binding: TraceBinding = {
    traceId,
    callerCorrelationRef: callerRef,
    routingContextHash: contextHash,
    mintedAt: input.now,
    mintedBy: 'HUB',
  };
  input.registry.put(binding);
  if (callerRef !== null) input.registry.bindCallerRef(callerRef, contextHash);
  return { ok: true, binding, code: null, reason: null };
}

export interface AssertTraceInput {
  readonly traceId: string;
  readonly routingContext: RoutingContext;
  readonly registry: TraceBindingRegistry;
  readonly callerCorrelationRef?: string | null;
}

/**
 * Assert that a presented trace identity was minted by the Hub for exactly this
 * routing context. Any mismatch is a forgery and fails closed.
 */
export function assertTraceBinding(input: AssertTraceInput): TraceDecision {
  if (!TRACE_ID_PATTERN.test(input.traceId)) {
    return { ok: false, binding: null, code: 'INTEGRITY_FAILED', reason: 'TRACE_ID_SHAPE_INVALID' };
  }
  const binding = input.registry.get(input.traceId);
  if (binding === undefined) {
    return { ok: false, binding: null, code: 'INTEGRITY_FAILED', reason: 'TRACE_ID_UNKNOWN' };
  }
  if (binding.mintedBy !== 'HUB') {
    return { ok: false, binding: null, code: 'INTEGRITY_FAILED', reason: 'TRACE_NOT_HUB_MINTED' };
  }
  const contextHash = hashRoutingContext(input.routingContext);
  if (binding.routingContextHash !== contextHash) {
    return {
      ok: false,
      binding: null,
      code: 'INTEGRITY_FAILED',
      reason: 'ROUTING_CONTEXT_MISMATCH',
    };
  }
  if (
    typeof input.callerCorrelationRef === 'string' &&
    input.callerCorrelationRef.length > 0 &&
    binding.callerCorrelationRef !== null &&
    binding.callerCorrelationRef !== input.callerCorrelationRef
  ) {
    return {
      ok: false,
      binding: null,
      code: 'INTEGRITY_FAILED',
      reason: 'CALLER_REFERENCE_MISMATCH',
    };
  }
  return { ok: true, binding, code: null, reason: null };
}
