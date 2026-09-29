# Product Registration Isolation — PATCHES + Law Shield (Phase 7 · Chat 3)

- Status: **ADDITIVE / NON-BREAKING**
- Owner: Full Stack Tech & Solutions LLC — Platform / Integration lane
- Compliance Core baseline: `thefsts/FSTS-COMPLIANCE-CORE` @
  `c7ac04b2d40624bef1742f819a9f7eee43e3d12c` (consumed, not modified)
- API Hub baseline: `thefsts/arma-api-hub` @ `356d00b` (this branch is additive)

## 1. Purpose

This note records how PATCHES and Law Shield are onboarded onto the ARMA API Hub
as **two separately governed products**, and — critically — records the
determination that **no transport change is genuinely required** to do so.

The directive for this lane is to onboard the two products "through the ARMA API
Hub, only where transport changes are genuinely required." This lane therefore
first establishes whether a change is required, and only adds what the
determination justifies.

## 2. Determination — the Hub is already product-generic

The ARMA API Hub already supports arbitrary, distinct product registration and
governed transport generically. No transport logic is product-specific:

- `apiHub.service.register` (`packages/contracts/src/catalog.ts`,
  `serviceRegisterPayloadSchema`) is a generic registration payload: an arbitrary
  `serviceId`, `productId`, `environment`, `owner`, `classification`, and a
  scoped `capabilities[]`. Nothing in the schema names or allow-lists a specific
  product.
- The service record model (`serviceRecordSchema` in
  `packages/contracts/src/registry.ts`) already carries `productId`,
  `ownership`, `authorizedTenantIds`, `capabilities`, `connections`,
  `keyIds`, and `killSwitchEngaged` — the full per-product isolation surface.
- The transport client (`packages/compliance-core-client`) builds the governed
  Core envelope with `productId` as an **input** field
  (`buildGovernedEnvelope`). It is not bound to a single product.
- There is no product allow-list, no per-product branch, and no product-specific
  code path that would need to be extended for PATCHES or Law Shield.

**Conclusion: no transport code change is required.** Adding a product-specific
code path would *weaken* the boundary by introducing exactly the kind of
product-coupled logic the control plane is designed to avoid.

## 3. What this lane adds (additive data + tests only)

Because the Hub is already generic, this lane adds only **additive, non-breaking
artifacts** that make the two controlled onboardings explicit and testable:

- `contracts/products/patches.compliance-signals.register.json` — the PATCHES
  registration descriptor, a valid `apiHub.service.register` payload.
- `contracts/products/lawshield.compliance-assurance.register.json` — the Law
  Shield registration descriptor, a valid `apiHub.service.register` payload.
- `tests/integration/product-registration-isolation.test.ts` — proves both
  descriptors validate against the **existing** schema and are distinct.
- this note.

No schema is added, renamed, widened, or restated. No Core contract is modified.

## 4. The two registrations are distinct

| Dimension | PATCHES | Law Shield |
|-----------|---------|------------|
| `serviceId` | `svc-patches-compliance-signals` | `svc-lawshield-compliance-assurance` |
| `productId` | `patches` | `arma-law-shield` |
| `environment` | `PRODUCTION` | `PRODUCTION` |
| owning system | `PATCHES` | `LAW_SHIELD` |
| capabilities | `evidence.metadata.write`, `telemetry.write` | `evidence.metadata.write`, `compliance.read`, `telemetry.write` |
| authorized tenants | `patches-tenant-alpha`, `patches-tenant-beta` | `lawshield-tenant-gamma`, `lawshield-tenant-delta` |

The two products legitimately share the Core/Hub scope **names**
`evidence.metadata.write` and `telemetry.write`. That is shared *vocabulary*,
not shared *authority*: authority is carried by the distinct `serviceId`,
`productId`, owning system, and tenant scope. The isolation test asserts this
distinction explicitly.

## 5. What is NOT changed

- The API Hub never reads or writes the Compliance Core Convex database.
- The API Hub transports; the Compliance Core decides. A transport outcome is
  never a compliance verdict.
- PATCHES remains a privacy / anti-surveillance product; the Compliance Core
  never absorbs PATCHES application logic. Only compliance-relevant signals and
  evidence references cross the boundary.
- Law Shield is not the canonical regulatory authority; the Compliance Core
  remains the legal/regulatory authority. A Law Shield event is never an
  automatic legal approval.
- No secrets or private signing keys. Only credential *references* exist.

## 6. Verification

Run the Hub suite:

```
pnpm test
```

The isolation test (`tests/integration/product-registration-isolation.test.ts`)
is additive and runs alongside the existing contract, security, and integration
suites. It fails closed if a registration is malformed, if the two products
collide on an authority-bearing dimension, or if a capability outside the shared
scope vocabulary is declared.
