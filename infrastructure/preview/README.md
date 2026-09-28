# Infrastructure — Preview

This directory holds the preview-environment infrastructure definitions for the
ARMA API Hub control plane. Preview is the environment where a candidate change
is exercised end to end before it is promoted to production.

## Scope

Preview mirrors the production topology closely enough to validate the console,
the service-facing API, and the durable worker together, but it is not
production. Preview must never hold production credentials, production customer
data, or production connector destinations. Outbound delivery is disabled by
default so that no event leaves the preview environment.

## Contents

This directory is intentionally a placeholder in Phase 0. The runtime
architecture is defined in `docs/architecture/RUNTIME-ARCHITECTURE.md` and the
runtime ADR in `docs/decisions/0002-runtime-architecture.md`. Concrete
infrastructure definitions are added in a later phase once a deployment target
is selected and its tradeoffs are documented.

## Constraints

No production provider is selected in Phase 0. Any provider added here must be
documented with its tradeoffs before it is used. Preview must remain isolated
from development and production, with separate configuration, separate
credentials, and separate data stores. Preview must not be able to deliver to a
production connector destination.
