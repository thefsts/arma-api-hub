# Security — Dependency Audit and SBOM

## Purpose

This document records how the ARMA API Hub validates its dependency surface and
produces a Software Bill of Materials, and it records the accepted residual
advisories at the time of the Phase 9 freeze. It exists so that the dependency
posture is auditable and so that any residual risk is explicit rather than
implicit.

## Gates

The Hub runs three dependency gates in `pnpm validate` and in CI. All three are
reachable through the single `pnpm deps:check` entry point, which chains the
workspace hygiene check, the vulnerability audit, and SBOM generation in that
order. Chaining them this way means the CI workflow needs no bespoke per-gate
step: any run that executes the dependency check also executes the audit and
emits the SBOM, so the gates cannot silently drift out of CI coverage.

`pnpm deps:check` is the workspace hygiene check. It verifies that every
workspace package declares a name and version, that no dependency uses a floating
`*` or `latest` range, that internal workspace dependencies use the `workspace:`
protocol, and that the root pins Node 24 and the package manager. This gate is
about reproducibility and supply-chain determinism rather than vulnerability
data.

`pnpm deps:audit` runs `pnpm audit --audit-level high`. It fails the build on any
high or critical advisory and reports moderate and low advisories without failing.
The threshold is deliberate: a critical or high advisory in a shipped runtime
dependency is a release blocker, while a moderate advisory in a development-only
tool is tracked and reviewed rather than allowed to block every build. Lowering
the threshold to fail on moderate would force either a major tool upgrade under
time pressure or a blanket suppression, and neither is a good security outcome.

`pnpm sbom` generates a CycloneDX 1.5 JSON SBOM from the committed
`pnpm-lock.yaml` plus the workspace packages, written to
`dist/sbom/arma-api-hub.cdx.json`. Each third-party component carries its
resolved version, integrity hash, and package URL, so the SBOM is reproducible
from the lockfile alone. When the CI workflow is run with a token that carries
`workflow` scope, the file is additionally uploaded as the `sbom-cyclonedx`
artifact; the generation gate itself runs unconditionally as part of
`pnpm deps:check`.

## Remediation performed for the Phase 9 freeze

The initial audit reported 24 advisories, including 2 critical, 3 high, and 13
moderate. The runtime-affecting findings were remediated by upgrading within the
declared semver ranges and by pinning safe transitive versions through pnpm
overrides.

The runtime upgrades were `zod` from 4.6.5 to 4.6.6, which addresses a memory
exhaustion advisory in constrained-collection validation, and `fastify` from
5.12.5 to 5.12.6, which addresses a header-validation bypass. Both are patch
releases and both are runtime dependencies, so both were mandatory.

The transitive overrides pin `fast-uri` to 4.2.3, `source-map-js` to 1.2.2,
`tinypool` to 2.1.2, `glob` to 14.0.2, `minimatch` to 11.0.1, and `vite` to
7.3.7. These resolve the critical tinypool advisory, the high source-map-js and
vite advisories, and the low and moderate fast-uri, glob, and minimatch
advisories. After remediation the audit reports 3 moderate advisories.

## Accepted residual

The 3 remaining moderate advisories are all in the test runner: `vitest`,
`@vitest/mocker`, and `@vitest/mocker` again for a second advisory. They are
development-only. They are not present in the built application, are not loaded
at runtime, and are not shipped to any environment. Remediating them requires a
major upgrade from vitest 3 to vitest 4, which is a test-infrastructure change
outside the scope of the Phase 9 observability lane and carries its own
regression risk.

The accepted position is that these advisories are tracked, are dev-only, and do
not affect the production attack surface. They are recorded here so that the
decision is explicit, and the recommended follow-up is a dedicated vitest 4
upgrade in a separate lane with its own validation, rather than folding a test
framework major upgrade into a frozen observability change.

## SBOM output

The SBOM is written to `dist/sbom/arma-api-hub.cdx.json` and is not tracked in
git, because it is a build artifact that must be regenerated from the lockfile at
build time. CI uploads it as the `sbom-cyclonedx` artifact so that every build has
a corresponding, immutable bill of materials.
