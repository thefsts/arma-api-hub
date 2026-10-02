// ARMA API Hub — governed boundary loader (Phase 8 hardening).
//
// The governed worker needs two runtime collaborators that live OUTSIDE the
// worker process boundary:
//
//   1. the existing internal Convex routing boundary
//      (`internal.productOnboardings.route`), and
//   2. the Compliance Core transport (a transport-only client).
//
// Neither is imported directly by the worker: the Hub must never reach the Core
// database directly (see `assertNoDirectCoreDatabaseAccess`), and the internal
// Convex boundary is not client-callable. They are injected at runtime.
//
// In Phase 0 / DEVELOPMENT there is NO live boundary configured and outbound
// delivery is disabled by default. This loader therefore returns `null` and the
// worker idles: it never invents production infrastructure and never dispatches
// ungoverned. A configured deployment supplies a live boundary through this
// single, auditable injection point.

import type { loadConfig } from '@arma/config';
import type { GovernedBoundary } from './composition.js';

/**
 * Load the governed boundary for the configured runtime. Returns `null` when no
 * live boundary is configured (the DEVELOPMENT/Phase 0 default), in which case
 * the worker must idle rather than dispatch.
 */
export function loadGovernedBoundary(
  _config: ReturnType<typeof loadConfig>,
): GovernedBoundary | null {
  // No live internal boundary or Core transport is configured in DEVELOPMENT.
  // Returning null keeps the worker fail-closed: it holds rather than dispatches.
  return null;
}
