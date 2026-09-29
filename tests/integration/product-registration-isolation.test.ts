// Phase 7 · Chat 3 — PATCHES + Law Shield controlled onboarding: registration
// isolation.
//
// PATCHES and Law Shield onboard onto the ARMA API Hub as TWO SEPARATELY
// GOVERNED products. This suite proves the Hub-side registration boundary is
// respected WITHOUT any transport change: both registrations are validated
// against the EXISTING `apiHub.service.register` schema (no schema is added,
// widened, or renamed), and the two products are asserted to be distinct on
// every authority-bearing dimension.
//
// The suite fails if anyone:
//   - reuses a serviceId or productId across the two products;
//   - collapses the two products into one registration;
//   - grants a capability that is not in the shared Core/Hub scope vocabulary;
//   - widens the registration schema to admit a foreign or unknown field;
//   - introduces secret material into a registration descriptor.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  classifyProductOwnership,
  normalizeProductName,
  serviceRegisterPayloadSchema,
  validate,
} from '@arma/contracts';

const root = fileURLToPath(new URL('../../', import.meta.url));

const PATCHES_DESCRIPTOR = 'contracts/products/patches.compliance-signals.register.json';
const LAW_SHIELD_DESCRIPTOR = 'contracts/products/lawshield.compliance-assurance.register.json';

// The shared Hub scope vocabulary. A registration may only declare capabilities
// drawn from this vocabulary; the two products legitimately share scope NAMES
// (shared Core vocabulary), which is NOT shared authority.
const HUB_SCOPE_VOCABULARY = new Set([
  'compliance.read',
  'compliance.write',
  'verification.submit',
  'evidence.metadata.write',
  'policy.distribute',
  'adoption.receipt.submit',
  'rollback.request',
  'telemetry.write',
]);

interface Registration {
  serviceId: string;
  displayName: string;
  productId: string;
  environment: string;
  owner: { ownerId: string; displayName: string; contactRef: string; function?: string };
  classification: string;
  capabilities: {
    capability: string;
    direction: string;
    maxClassification: string;
    requiresApproval: boolean;
  }[];
}

function load(relativePath: string): Registration {
  return JSON.parse(readFileSync(`${root}${relativePath}`, 'utf8')) as Registration;
}

const patches = load(PATCHES_DESCRIPTOR);
const lawShield = load(LAW_SHIELD_DESCRIPTOR);

describe('PATCHES + Law Shield registration isolation (no transport change)', () => {
  it('validates both registrations against the EXISTING apiHub.service.register schema', () => {
    for (const [label, descriptor] of [
      ['PATCHES', patches],
      ['Law Shield', lawShield],
    ] as const) {
      const result = validate(serviceRegisterPayloadSchema, descriptor);
      expect(result.ok, `${label} registration failed the existing schema`).toBe(true);
    }
  });

  it('rejects a registration carrying an unknown field (strict schema unchanged)', () => {
    const result = validate(serviceRegisterPayloadSchema, { ...patches, sharedAuthority: true });
    expect(result.ok).toBe(false);
  });

  it('assigns a distinct serviceId to each product', () => {
    expect(patches.serviceId).toBe('svc-patches-compliance-signals');
    expect(lawShield.serviceId).toBe('svc-lawshield-compliance-assurance');
    expect(patches.serviceId).not.toBe(lawShield.serviceId);
  });

  it('assigns a distinct productId to each product', () => {
    expect(patches.productId).toBe('patches');
    expect(lawShield.productId).toBe('arma-law-shield');
    expect(patches.productId).not.toBe(lawShield.productId);
  });

  it('binds each serviceId to exactly one productId (1:1, no reuse)', () => {
    const bindings = new Map<string, string>([
      [patches.serviceId, patches.productId],
      [lawShield.serviceId, lawShield.productId],
    ]);
    expect(bindings.size).toBe(2);
    expect(new Set(bindings.values()).size).toBe(2);
  });

  it('classifies both products as FSTS-owned yet distinct', () => {
    expect(classifyProductOwnership(patches.productId)).toBe('FSTS_OWNED');
    expect(classifyProductOwnership(lawShield.productId)).toBe('FSTS_OWNED');
    expect(normalizeProductName(patches.productId)).not.toBe(
      normalizeProductName(lawShield.productId),
    );
  });

  it('does not collide with the example sentinel registration', () => {
    const sentinel = load('contracts/api/apiHub.service.register.json');
    expect(patches.serviceId).not.toBe(sentinel.serviceId);
    expect(lawShield.serviceId).not.toBe(sentinel.serviceId);
    expect(patches.productId).not.toBe(sentinel.productId);
    expect(lawShield.productId).not.toBe(sentinel.productId);
  });

  it('declares only capabilities drawn from the shared Hub scope vocabulary', () => {
    for (const descriptor of [patches, lawShield]) {
      for (const capability of descriptor.capabilities) {
        expect(
          HUB_SCOPE_VOCABULARY.has(capability.capability),
          `unknown capability ${capability.capability}`,
        ).toBe(true);
      }
    }
  });

  it('keeps the two capability sets distinct (Law Shield reads compliance; PATCHES does not)', () => {
    const patchesCaps = new Set(patches.capabilities.map((c) => c.capability));
    const lawShieldCaps = new Set(lawShield.capabilities.map((c) => c.capability));
    expect(lawShieldCaps.has('compliance.read')).toBe(true);
    expect(patchesCaps.has('compliance.read')).toBe(false);
    expect([...patchesCaps].sort()).not.toEqual([...lawShieldCaps].sort());
  });

  it('shares the common evidence/telemetry scope NAMES without sharing authority', () => {
    const patchesCaps = new Set(patches.capabilities.map((c) => c.capability));
    const lawShieldCaps = new Set(lawShield.capabilities.map((c) => c.capability));
    // Shared Core vocabulary is expected and is not a violation.
    expect(patchesCaps.has('evidence.metadata.write')).toBe(true);
    expect(lawShieldCaps.has('evidence.metadata.write')).toBe(true);
    expect(patchesCaps.has('telemetry.write')).toBe(true);
    expect(lawShieldCaps.has('telemetry.write')).toBe(true);
    // Authority is still distinct because the identities are distinct.
    expect(patches.serviceId).not.toBe(lawShield.serviceId);
    expect(patches.productId).not.toBe(lawShield.productId);
  });

  it('carries no secret-like material in either descriptor', () => {
    for (const relativePath of [PATCHES_DESCRIPTOR, LAW_SHIELD_DESCRIPTOR]) {
      const raw = readFileSync(`${root}${relativePath}`, 'utf8');
      expect(raw).not.toMatch(/BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/);
      expect(raw).not.toMatch(/AKIA[0-9A-Z]{16}/);
      expect(raw).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
    }
  });

  it('requires approval for the evidence-metadata capability on both products', () => {
    for (const descriptor of [patches, lawShield]) {
      const evidence = descriptor.capabilities.find(
        (c) => c.capability === 'evidence.metadata.write',
      );
      expect(evidence).toBeDefined();
      expect(evidence?.requiresApproval).toBe(true);
      expect(evidence?.direction).toBe('OUTBOUND');
    }
  });
});
