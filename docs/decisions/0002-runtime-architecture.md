# ADR 0002: Runtime architecture for the API Hub control plane

- Status: Accepted
- Date: 2026-09-21
- Owner: Full Stack Tech & Solutions LLC
- Supersedes: none
- Related: ADR 0001 (API Hub as an integration control plane)

## Context

The API Hub must serve a service-facing API, run an operator console, and
execute durable background work such as webhook delivery with retries and
dead-letter handling. These concerns have different scaling, availability, and
lifecycle characteristics. The API must stay responsive; the worker must
survive long backoff windows and process restarts; the console must ship
operator-facing changes independently. The runtime must also be safe by
default: it must fail closed, never store key material, and never let a
misconfiguration deliver to a real destination.

The runtime must be reproducible across developer machines, preview
environments, and production. It must be testable without external services so
that the sixteen required scenarios can be proven deterministically. It must
not depend on short-lived frontend functions for durable work.

## Decision

The API Hub runtime is a Node.js 24, strict-TypeScript, pnpm workspace
orchestrated with Turborepo. It is composed of eleven packages and four apps.
The three long-lived units — the service-facing API, the durable worker, and
the operator console — are separate deployable units that share packages but
not processes.

The service-facing API is built on Fastify 5. The durable worker consumes a
queue and processes jobs with a fixed, bounded retry schedule and dead-letter
handling; the processor is a pure function of (job, handler). The console is a
shell that never holds privileged credentials in the browser.

Durable work runs only in the worker. Webhook delivery and durable jobs must
not depend on short-lived frontend functions, because such functions cannot
provide retries across minutes and hours, ordered processing, or dead-letter
guarantees.

The database, queue, and secrets manager are not selected in Phase 0. The
runtime defines the contracts they must satisfy. No production provider is
chosen without a documented tradeoff.

## Alternatives considered

**A single monolithic process serving the API, the worker, and the console.**
Rejected. A single process couples the availability of the API to the
long-running backoff windows of the worker and forces the console to redeploy
with the API. It also makes independent scaling impossible.

**Serverless functions for the API and the worker.** Rejected for the worker.
Serverless functions are bounded by short execution timeouts and are not
guaranteed to run to completion, so they cannot provide the durability, bounded
retries, and dead-letter guarantees that webhook delivery requires. A
serverless API is not excluded in principle, but it must not be used for
durable work.

**A frontend function triggering webhook delivery.** Rejected. Delivery tied to
a user request would silently drop deliveries on slow subscribers, transient
outages, or process restarts, with no durable record of the failure.

**A shared database across products.** Rejected by ADR 0001. Each product owns
its database; cross-product data flows only through registered contracts and
events.

**Selecting a production database, queue, and secrets manager now.** Deferred.
Selecting them without a documented tradeoff would violate the Phase 0
constraint. The contracts are defined so the choice can be made deliberately in
a later phase.

## Consequences

The platform gains independent deployability, independent scaling, and a clear
separation between request-serving and durable work. Durable work is
deterministic and testable because the processor is a pure function. The
runtime is fully exercisable locally through in-memory implementations, so the
required scenarios can be proven without external services.

The cost is more moving parts: three deployable units, a queue, and a database
must each be operated and monitored. The team must maintain the queue and
database contracts and must choose providers with documented tradeoffs. The
worker must be operated as a long-running process, which rules out platforms
that cannot run long-lived processes.

## Follow-up decisions

The following decisions are deferred and must be recorded as ADRs before
production: the production database, the production queue or broker, the
production secrets manager, the deployment platform, and the production
observability backend. Each must document its tradeoffs, its durability and
delivery guarantees, and its rotation and audit capabilities.
