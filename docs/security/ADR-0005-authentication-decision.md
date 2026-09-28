# ADR 0005: Phase 0 authentication and authorization decision

- Status: Accepted
- Date: 2026-09-22
- Owner: Full Stack Tech & Solutions LLC
- Supersedes: none
- Related: ADR 0001 (API Hub as an integration control plane), ADR 0002 (runtime architecture), ADR 0004 (cost ownership)

## Context

The ARMA API Hub is a shared control plane. It holds system, service, tenant,
customer, credential-metadata, webhook, connector, incident, audit, and cost
records for every FSTS-owned system. A single authorization mistake here is a
cross-tenant data breach, so the Phase 0 security hold requires that the
authentication and authorization model be explicit, fail-closed, and testable
before any Phase 1 work begins.

Two facts shaped the decision.

First, no human identity provider has been approved for Phase 0. There is no
Clerk application, no configured OIDC issuer, and no agreed claim mapping. The
Phase 0 Convex functions were originally written as public `query`/`mutation`
functions that read a `roles` claim straight off the caller's identity. That is
unsafe for two reasons: a public Convex function is reachable by anyone who can
reach the deployment, and a role claim parsed directly from an identity is only
as trustworthy as the issuer that signed it. With no approved issuer, there is
nothing to trust.

Second, the platform already has a durable, auditable place to record who may do
what: the database. Authorization does not need to be inferred from a token. It
can be resolved from a record that an operator writes, that is versioned, and
that can be suspended or revoked.

## Decision

Phase 0 adopts **Option 2: convert administrative and control-plane data
functions to internal functions until a management-console identity provider is
approved.** No fake authentication provider is introduced, and no identity claim
is hard-coded.

Concretely:

1. **Every control-plane data function is an internal function.** All reads and
   writes under `convex/**` are `internalQuery` / `internalMutation`. Internal
   functions are not client-callable, so there is no unauthenticated human path
   into the control plane. The service-facing API and the durable worker reach
   these functions through the trusted internal boundary, not through a public
   Convex client.

2. **`convex/auth.config.ts` is intentionally not committed.** A committed
   `auth.config.ts` with a placeholder issuer would be a fake authentication
   provider. The guardrail script fails the build if a public function ever
   depends on `ctx.auth` without a committed `auth.config.ts`, so the moment a
   real provider is approved the configuration must be added deliberately.

3. **Authorization is server-derived, never caller-supplied.** The authenticated
   subject is verified against the configured trusted issuer, then resolved
   against a durable `principalAuthorizations` record. The resulting scope —
   permitted systems, services, tenants, customers, capabilities, and
   environments — is what gets enforced. Caller-supplied roles, tenant IDs,
   service IDs, customer references, and correlation IDs are never trusted.

4. **The trusted issuer is configuration, and it fails closed.** The issuer is
   read from the `ARMA_TRUSTED_ISSUER` environment variable. When it is unset,
   no caller is ever considered authenticated. This is deliberate: an unset
   issuer must deny, not allow.

5. **Cross-scope access requires an explicit, durable global grant.** The only
   way to read across tenants, services, or customers is a `principalAuthorizations`
   record with `global: true`. That grant is modeled, authenticated, tested, and
   audited. It is the FSTS owner/admin grant, and it is not implied by any role
   claim.

## Authorization model

A caller is authenticated when `ctx.auth.getUserIdentity()` returns an identity
whose `issuer` equals `ARMA_TRUSTED_ISSUER` and whose `subject` is non-empty. The
verified subject is then looked up in `principalAuthorizations` by
`(principalId, state = ACTIVE)`. The record yields:

- `principalType`: `HUMAN` or `SERVICE`
- `roles`: `admin | operator | service | viewer`
- `global`: the explicit cross-scope grant
- `systemIds`, `serviceIds`, `tenantIds`, `customerRefs`: the authorized scopes
- `capabilities`, `environments`: capability and environment scopes
- `state`: `ACTIVE | SUSPENDED | REVOKED`

Every read enforces the relevant scope before returning a row. A `viewer`,
`operator`, or `service` cannot gain cross-tenant or cross-service access by
supplying another tenant ID, service ID, cost-event ID, key ID, correlation ID,
or customer reference. Missing, malformed, unknown, or untrusted identity fails
closed.

## Service-identity binding

A service caller is bound to its server-derived service identity. A service may
only read or affect its own resources. Supplying another service's `serviceId`
is rejected by `requireServiceBinding`, even when the caller holds the `service`
role. This applies to idempotency records, nonce records, capability grants,
credential metadata, webhook configuration, connector health, and cost records.
Connectors are sub-resources of a service; the owning service is resolved from
durable `connectorSubscriptions` / `connectorHealth` records, and an unbound
connector fails closed.

## Deterministic, reactive queries

Convex queries must be deterministic and reactive. No query handler reads
`Date.now()`, `Math.random()`, or any other nondeterministic source, and no query
accepts caller-supplied time for an authorization decision. Two patterns are
used instead:

- **Materialized status.** Capability expiration is written into the stored
  `status` field (`ACTIVE | EXPIRED | REVOKED`) by the scheduled internal
  mutation `capabilities.expireGrants`. Reads check `status` only.
- **Trusted evaluation timestamp.** Where a time comparison is unavoidable
  (nonce replay windows, idempotency TTLs, due-delivery selection), the
  timestamp is passed in as an explicit argument from the trusted internal
  service boundary, never from an untrusted client.

The guardrail script fails the build if `Date.now()` appears inside a query
handler.

## Consequences

- Phase 0 has no human-facing authentication. The management console cannot call
  the control plane until an identity provider is approved and `auth.config.ts`
  is committed. This is the intended, safe Phase 0 posture.
- Every authorization decision is backed by a durable, auditable record. Role
  and scope changes are made by writing to `principalAuthorizations`, which can
  be suspended or revoked.
- The service-facing API and worker must present a verified service identity
  through the internal boundary. They do not rely on public Convex functions.
- When a human identity provider is approved, the work is bounded: commit
  `auth.config.ts`, map the issuer's claims to a verified subject, and keep the
  durable `principalAuthorizations` records as the source of scope. The
  enforcement layer does not change.

## Alternatives considered

- **Configure a placeholder issuer.** Rejected: a placeholder issuer is a fake
  authentication provider and would present unauthenticated access as
  production-ready.
- **Trust the `roles` claim from the identity.** Rejected: with no approved
  issuer there is nothing to trust, and a claim parsed directly from a token
  lets an arbitrary user self-assign `admin`.
- **Keep public functions and add a role check.** Rejected: a public function is
  reachable by anyone who can reach the deployment, so the check would be the
  only barrier and the surface would remain exposed.
