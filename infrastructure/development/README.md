# Infrastructure — Development

This directory holds the development-environment infrastructure definitions for
the ARMA API Hub control plane. Development is the environment where engineers
run the console, the service-facing API, and the durable worker locally or in a
shared non-production sandbox.

## Scope

Development infrastructure is non-production. It must never hold production
credentials, production customer data, or production connector destinations. All
secrets are placeholders or locally generated test values. Outbound delivery is
disabled by default (`API_HUB_OUTBOUND_DELIVERY_DISABLED=true`) so that no event
leaves the development environment.

## Contents

This directory is intentionally a placeholder in Phase 0. The runtime
architecture is defined in `docs/architecture/RUNTIME-ARCHITECTURE.md` and the
runtime ADR in `docs/decisions/0002-runtime-architecture.md`. Concrete
infrastructure definitions are added in a later phase once a deployment target
is selected and its tradeoffs are documented.

## Constraints

No production provider is selected in Phase 0. Any provider added here must be
documented with its tradeoffs before it is used. Development must remain
isolated from preview and production, with separate configuration, separate
credentials, and separate data stores.
