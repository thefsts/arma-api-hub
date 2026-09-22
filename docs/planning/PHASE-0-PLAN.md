# Phase 0 Plan — ARMA API Hub Foundation

## Purpose

Phase 0 establishes the foundation for the ARMA API Hub: a secure shared API,
event, identity, contract, webhook, and integration control plane for
FSTS-owned systems and approved external or client systems. Phase 0 is a
foundation phase. It does not connect to production systems, does not hold
production credentials, and does not simulate production readiness. Its output
is a frozen, versioned, testable surface that later phases build against.

The control plane exists because FSTS operates a growing portfolio of products
(ARMA System 360, ARMA Sentinel, Alert ARMA, ARMA Domus, ARMA Command Center,
ARMA Cannabis Security & Logistics, Operon CRM, ARMA LawShield, FSTS Compliance
Core, FSTS AI Hub, Qualivanta, Regivanta, PATCHES, SafePlay Network,
PortalServexa, TAYA, and Euphoric LS) plus approved external and client
integrations. Without a shared control plane, each product would reinvent
service identity, signing, retries, webhook delivery, contract versioning, and
auditability — and each reinvention would be a place where secrets leak, events
are lost, or tenant boundaries blur. The API Hub centralizes exactly those
cross-cutting concerns while deliberately leaving product-owned concerns with
the products.

## Scope of Phase 0

Phase 0 delivers eight workstreams, each of which is complete only when it is
verifiable from the repository:

1. **Architecture inspection and reuse assessment.** Inspect the existing FSTS
   repositories, identify reusable patterns, and record what can be reused,
   what must change, and what security concerns each pattern carries. Repos
   that are unavailable are reported as unavailable and are never invented.
2. **Runtime architecture decision.** Select and document the runtime
   architecture (Node.js 24, TypeScript strict, pnpm workspaces, Turborepo, a
   service-facing API, a durable worker, a queue with retry and dead-letter
   handling, a database, environment separation, observability, local
   development, secrets management, and deployment alternatives). The decision
   is recorded as an ADR with explicit tradeoffs.
3. **Monorepo scaffold.** Create the exact directory structure the program
   requires, with each package and app owning a single responsibility.
4. **Repository tooling.** Enforce Node 24, pin the package manager, enable
   TypeScript strict mode, and provide formatting, linting, unit tests,
   workspace typecheck, dependency checks, secret scanning, build verification,
   a CI workflow, a sanitized `.env.example`, and scripts for lint, typecheck,
   test, build, and validate.
5. **Shared envelope contracts.** Define the versioned, runtime-validated
   envelopes for service requests, events, webhook deliveries, signed receipts,
   standard API errors, connector health reports, correlation and causation
   identifiers, and idempotency metadata.
6. **Registry contracts.** Define the registry model for FSTS products, client
   systems, partners, services, environments, capabilities, connections,
   contract versions, owners, data classifications, dependencies, onboarding
   status, and kill-switch state.
7. **Initial contract catalog.** Define fifteen named contracts with schemas and
   sanitized fixtures. These contracts are not connected to production in
   Phase 0.
8. **Testing.** Provide deterministic tests for sixteen required scenarios using
   only synthetic data.

## The platform boundary (locked)

The boundary between the API Hub and each product is locked and must not be
weakened. Each FSTS product owns its database, its business logic, its user and
tenant authorization, its customer data, its product audit trail, and its
product security decisions. The API Hub owns the registry, the
external-integration registry, service identity, credential lifecycle, API and
event contracts, contract versions and deprecation, webhooks, event routing,
retries and dead-letter handling, idempotency, correlation and causation
identifiers, signed receipts, connector health, destination allow lists, rate
limits, kill switches, and integration monitoring and auditability.

Three hard rules follow from the boundary. First, no product may directly query
another product's database; cross-product data flows only through registered
contracts and events. Second, no browser or mobile client may hold privileged
API Hub credentials; privileged credentials are held only by server-side
services. Third, the API Hub must not independently approve legal actions,
evidence disclosure, cannabis compliance, payments, emergency dispatch,
security responses, or AI decisions; it routes and records those decisions but
never makes them.

## Deliverables

Phase 0 produces the following artifacts, all committed to the
`foundation/platform-runtime` branch and proposed through a single pull request:

- A working monorepo with eleven packages and four apps.
- Shared envelope and registry contracts with runtime validation.
- An initial catalog of fifteen contracts with sanitized fixtures.
- A deterministic test suite covering sixteen required scenarios.
- Nine required documents: this plan, the reuse assessment, the runtime
  architecture document, the runtime ADR, the threat model, the data
  classification standard, the service onboarding guide, the credential
  revocation runbook, and the connector kill-switch runbook.
- A CI workflow that runs on pull requests and pushes to `main`.

## Non-goals

Phase 0 does not select or provision a production database, does not connect to
any production system, does not implement a production message broker, does not
provision real credentials, and does not deploy to production. It does not
implement product business logic. It does not make compliance, legal, payment,
dispatch, or AI decisions. It does not weaken or relicense the repository's
existing governance files.

## Exit criteria

Phase 0 is complete when: the repository builds, typechecks, lints, formats,
tests, scans for secrets, and checks dependencies cleanly; the sixteen test
scenarios pass deterministically; the nine documents exist and are consistent
with the code; the pull request is open and unmerged; and no production secret,
credential, or customer data has been committed.

## Handoff to Phase 1

Phase 1 begins only after the Phase 0 pull request is reviewed and merged by
the program manager. Phase 1 lanes are described in the runtime architecture
document and in the pull request. The recommended division of labor is
described in the final report.
