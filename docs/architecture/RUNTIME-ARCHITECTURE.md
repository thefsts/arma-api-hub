# Runtime Architecture — ARMA API Hub

## Overview

The ARMA API Hub is a control plane. It does not run product business logic; it
governs how FSTS products and approved external systems identify themselves,
sign requests, publish and consume events, receive webhooks, and remain
auditable. The runtime is organized so that the three long-lived concerns —
serving the service-facing API, running the operator console, and executing
durable background work — are separate deployable units that share a common set
of packages.

The runtime is built on Node.js 24 with TypeScript in strict mode, organized as
a pnpm workspace and orchestrated with Turborepo. Every package and app is
independently typechecked, linted, tested, and built. The dependency graph is
explicit and acyclic.

## Language and toolchain

Node.js 24 is the runtime baseline. It is enforced in three places: the
`engines` field of the root `package.json`, the `.nvmrc` file, and the
`.node-version` file. The package manager is pinned to pnpm 10.34.5 through the
`packageManager` field and the `engines.pnpm` constraint, so every environment
resolves dependencies identically. Turborepo provides task orchestration and
caching across the workspace.

TypeScript is configured in strict mode with additional safety flags:
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and
`verbatimModuleSyntax`. These flags eliminate whole classes of defects —
undefined index access, optional-property ambiguity, and import elision — that
are especially dangerous in a control plane where a missing field must fail
closed rather than silently default.

## Workspace layout

The workspace has eleven packages and four apps.

The packages are: `contracts` (versioned, runtime-validated envelopes, registry
records, and the contract catalog), `crypto` (canonical request signing and
verification), `config` (environment loading with fail-closed defaults),
`events` (event envelope construction and ordering), `observability`
(redaction-safe logging), `policy` (the fail-closed decision engine and the
admission pipeline), `auth` (service identity and credential lifecycle),
`database` (persistence contracts and in-memory implementations for local
development and tests), `sdk` (the service-facing signing SDK), `testing`
(synthetic fixtures), and `ui` (console design tokens).

The apps are: `api` (the service-facing HTTP API), `worker` (the durable job
processor), `console` (the operator console shell), and `docs` (the rendered
documentation site).

## The three deployable units

The API, the worker, and the console deploy independently. They share packages
but not processes. This separation is deliberate: the API must stay responsive
under load, the worker must survive long-running retries and backoff windows,
and the console must be able to ship operator-facing changes without redeploying
the API or the worker. Because the units are independent, a failure or a
deployment in one does not take down the others.

### Service-facing API

The API is built on Fastify 5. It exposes health and readiness endpoints and a
control-plane validation endpoint. It validates signed service request
envelopes, resolves the signing key reference, verifies the canonical
signature, and returns a standard error shape on failure. The API holds no
product business logic and no product database access. It is the only surface
that privileged server-side services call.

### Durable worker

The worker consumes jobs from a queue and processes them with retry and
dead-letter handling. Webhook delivery and other durable jobs run here. The
processor is a pure function of (job, handler) so its behavior is deterministic
and testable. The retry schedule is explicit — one second, five seconds, thirty
seconds, two minutes, and ten minutes — and failures are classified as clean
retryable, ambiguous, or terminal. Only clean retryable failures are retried
automatically. Ambiguous failures, where a side effect may or may not have
occurred, are never blindly retried; they are routed to reconciliation so an
accepted side effect is never duplicated. Terminal failures and exhausted
retries are dead-lettered.

### Operator console

The console is the human-facing surface for the control plane. In Phase 0 it is
a shell that renders the console sections and design tokens. It never holds
privileged API Hub credentials in the browser; it calls the API through a
server-side boundary. The console deploys independently of the API and the
worker.

## Why durable work cannot depend on short-lived frontend functions

Webhook delivery and durable jobs must not depend on short-lived frontend
functions. A frontend function is bounded by a short execution timeout, is
invoked in response to a user request, and is not guaranteed to run to
completion. Webhook delivery requires retries across minutes and hours, ordered
processing, and dead-letter handling — none of which a short-lived function can
provide. If webhook delivery were tied to a frontend function, a slow
subscriber, a transient downstream outage, or a process restart would silently
drop deliveries, and there would be no durable record of the failure. The
worker exists precisely to provide the durability, bounded retries, and
dead-letter guarantees that delivery requires.

## Queue, retry, and dead-letter

The queue contract defines enqueue, reserve, acknowledge, dead-letter, and size
operations. The in-memory implementation is for local development and tests
only; production uses a durable broker. The retry schedule is fixed and
bounded. Each job carries its attempt count and its next-available time. When a
job fails cleanly and retries remain, it is re-enqueued with the scheduled
backoff. When retries are exhausted, or when the failure is ambiguous or
terminal, the job is dead-lettered with a reason. Dead-lettered jobs are
observable and auditable.

## Database

The database package declares the persistence surface the control plane
requires: services, products, capabilities, connections, contract versions,
credentials, events, event streams, webhook deliveries, receipts, idempotency
keys, the nonce registry, dead letters, connector health, kill switches, and
audit events. Phase 0 defines the repository interfaces and the required tables
but does not select or provision a production database. Two requirements are
non-negotiable for whichever database is chosen: the idempotency and nonce
registries must be enforced with unique indexes inside the same transaction as
the operation outcome, so a partial write can never poison the registry; and
the event store must support monotonic per-stream sequence numbers so ordering
gaps are detectable.

## Cost and Usage Guard

The Cost and Usage Guard is the part of the control plane that measures and
governs the cost of external usage. It is implemented as a set of Convex tables
and functions under `convex/`, alongside the core registry and delivery tables.
It stores the vendor registry and immutable vendor price versions, the usage and
cost ledger, the rate-limit, quota, budget, and spending-limit state, the
anomaly and optimization records, the cache, batch, and retry-waste records, the
vendor shutdown state, and the cost-export receipts.

The guard's monetary arithmetic is exact: every amount is an integer in minor
currency units, and the deterministic cost primitives reject a non-integer or
unsafe-integer input. The guard resolves the vendor price version that was
effective at the request time, so a later price change never rewrites history.
The cost ledger deduplicates on both the cost-event identifier and the
idempotency key, so the same external charge is never counted twice.

The guard emits eleven normalized cost events, each a strict, versioned contract
with a sanitized fixture, and it provides an AI Hub handoff contract that
references an authoritative cost event without carrying a monetary field, and a
REGIVANTA export contract that carries measured usage and cost without carrying a
profitability field. The cost-ownership boundary is recorded in the cost
ownership boundaries document and in ADR 0004, and it is enforced by the strict
contracts and by the deterministic tests.

## Environment separation

The runtime distinguishes three environments: development, preview, and
production. The environment is selected by configuration and is validated at
startup. Development uses in-memory implementations and synthetic fixtures.
Preview mirrors production topology with non-production data. Production uses
the durable broker, the production database, and real credentials provisioned
through the secrets manager. Outbound delivery and connector delivery default
to disabled in every environment; they are enabled only by explicit
configuration. This fail-closed default means a misconfigured environment
cannot accidentally deliver to a real destination.

## Observability

Observability is redaction-safe by construction. The observability package
provides a structured logger whose metadata is reduced to an allow-list of safe
keys, with a deny-list of forbidden keys and detection of registered secret
values. Raw secrets, signatures, credentials, and protected payloads can never
reach a log line or a telemetry span. Correlation and causation identifiers are
carried on every envelope so a request or event can be traced end to end
without exposing payload content.

## Local development

Local development requires only Node 24 and pnpm. A developer installs
dependencies, runs the validation suite, and starts the API, worker, or console
locally. The in-memory queue, in-memory credential store, in-memory policy
registry, and in-memory nonce and idempotency repositories make the control
plane fully exercisable without any external service. The sanitized
`.env.example` documents every configuration key with placeholder values and
fail-closed defaults.

## Secrets management

The API Hub never stores key material. It stores key references and their
lifecycle state. Actual key material is provisioned through the secrets manager
and resolved at runtime by reference. The signing secret is never logged,
never returned in an error, and never persisted. Credential rotation uses an
overlap window during which both the retiring and the new key verify, so
rotation is seamless. Revocation is immediate and auditable.

## Deployment alternatives

Phase 0 does not select a production provider. The runtime is designed so that
the API, the worker, and the console can be deployed to a container platform, a
managed application platform, or a virtual machine, provided the platform
supports long-running processes, a durable queue, a durable database, and a
secrets manager. No production provider is chosen without a documented
tradeoff. The tradeoffs to evaluate are: durability and delivery guarantees of
the queue, the database's transactional and unique-index capabilities, the
secrets manager's rotation and audit features, the platform's support for
long-running workers, and the cost and operational complexity of each option.
The runtime ADR records the decision and its tradeoffs.

## Summary

The runtime is a Node 24, strict-TypeScript, pnpm and Turborepo workspace with
three independently deployable units — API, worker, and console — sharing a
common set of packages. Durable work runs in the worker, never in a short-lived
frontend function. The database, queue, and secrets manager are chosen with
documented tradeoffs. Every environment fails closed by default.
