// FSTS Governed Product Conformance Kit — public surface.
//
// This package is the executable conformance contract for a governed product
// integration. It is black-box: it drives a client through the public SDK
// surface and asserts observable behaviour only. It never reaches into the
// client's internals and never talks to the Compliance Core directly.

export * from './harness.js';
export * from './areas.js';
export * from './report.js';
