# Infrastructure — Production

This directory holds the production-environment infrastructure definitions for
the ARMA API Hub control plane. Production is the environment that serves
registered FSTS-owned systems and approved external or client systems.

## Scope

Production is the only environment that may hold production credentials and
deliver to production connector destinations. Production is fail-closed:
outbound delivery is disabled by default and enabled only for connectors that
are registered, approved, active, and not killed. Production secrets are held in
a secrets manager and are never committed to this repository.

## Contents

This directory is intentionally a placeholder in Phase 0. The runtime
architecture is defined in `docs/architecture/RUNTIME-ARCHITECTURE.md` and the
runtime ADR in `docs/decisions/0002-runtime-architecture.md`. Concrete
infrastructure definitions are added in a later phase once a deployment target
is selected and its tradeoffs are documented.

## Constraints

No production provider is selected in Phase 0. Any provider added here must be
documented with its tradeoffs before it is used. Production must remain isolated
from development and preview, with separate configuration, separate credentials,
and separate data stores. Production infrastructure details are not committed to
this public repository; only sanitized, non-secret definitions belong here.
