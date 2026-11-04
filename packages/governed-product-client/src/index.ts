// FSTS Governed Product Client — public surface.
//
// A product imports ONLY this module. It constructs a governed client from a
// validated manifest and non-secret configuration, and calls governed methods.
// The product never imports the transport internals or the envelope primitives
// directly; those are re-exported here only for adapters and conformance.
//
// LOCKED: PRODUCT -> GOVERNED SDK -> ARMA API HUB -> COMPLIANCE CORE.
// The SDK reaches the API Hub only. It never reaches Compliance Core Convex.
// A GovernedResult is NEVER a compliance verdict. PASS != COMPLIANT.

export * from './constants.js';
export * from './errors.js';
export * from './denial-map.js';
export * from './manifest.js';
export * from './envelope.js';
export * from './transport.js';
export * from './retry.js';
export * from './health.js';
export * from './client.js';
export * from './compiler.js';
export {
  OPERATION_BINDING,
  OPERATION_COUNT,
  ROUTABLE_OPERATION_COUNT,
  UNROUTABLE_OPERATION_COUNT,
  isRoutableOperation,
} from './operation-binding.generated.js';
export type { OperationBinding } from './operation-binding.generated.js';
export {
  HUB_SCOPE_TO_CORE_SCOPES,
  mapDeclaredHubScopesToCoreScopes,
} from './scope-binding.generated.js';
