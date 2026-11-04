# Operations — Transport Observability

## Purpose

This document describes the transport observability model that the ARMA API Hub
operates in production. It explains what the Hub records, what it deliberately
does not record, how a transport observation differs from a compliance verdict,
and how operators should read the telemetry the Hub emits. It is the operational
companion to ADR 0006 (Transport Observation Model) and to the health-state and
SLO documents in this directory.

The Hub is the transport and governance layer between an FSTS product and the
FSTS Compliance Core. The product calls the Hub, the Hub transports the governed
request to the Core, the Core decides, and the Hub transports the decision back
to the product. Observability exists to make that transport legible to
operators. Observability does not exist to make the Hub a second decision-maker,
a second compliance authority, or a second source of truth about a product's
compliance posture. Every record the Hub writes describes what happened on the
wire and in the transport pipeline. No record the Hub writes states whether a
product is compliant, certified, approved, released, verified, or secure.

## The single append-oriented observation model

All transport telemetry is written to one append-oriented table,
`transportObservations`. There is no second telemetry table, no parallel event
log, and no denormalised copy of an observation in another store. A single
observation is a closed record with a fixed allow-list of fields. The writer
accepts only fields on that allow-list; any field outside it is dropped and
reported as a projection issue rather than persisted. This is deliberate. An
open-ended telemetry bag becomes a place where a caller can smuggle an assertion
that looks like a transport fact, and an assertion that looks like a fact is the
first step toward the Hub manufacturing a compliance claim.

An observation carries the Hub-minted trace identity, the correlation identity,
the service and product and tenant and environment context, the operation, the
direction, the outcome, the governed failure code when there is one, the
retryability of that failure, the HTTP status and latency where those apply, and
the operational state. It does not carry request or response bodies, headers,
credential material, signatures, nonces, raw evidence payloads, or free-form
vendor text. Those are excluded at the projection boundary, not filtered later.

Records are append-oriented. The Hub does not mutate a historical observation to
reflect a later outcome. A retry is a new observation, not an edit of the
original. A replay is a new observation, not an edit of the original. This keeps
the record honest: the history of a trace is the sequence of observations that
were actually written, and an operator reading the trace sees the transport as
it happened rather than a rewritten summary.

## Hub-minted trace identity

The Hub mints the trace identity. A caller cannot supply a trace identity and
have it accepted as authoritative. When a caller presents a trace identity, the
Hub verifies it against the binding registry and against the caller's routing
context. If the trace identity was not minted by the Hub, if it collides with an
existing binding, if its shape is invalid, or if it does not match the caller's
product, tenant, environment, service identity, and routing context, the Hub
rejects the request and records the rejection. The rejection is a transport
event with a specific reason, and the reason is recorded in the observation's
reason field rather than being collapsed into a single opaque code.

This matters operationally because a forged or replayed trace identity is the
mechanism by which an attacker would try to make one tenant's transport look
like another tenant's transport, or make a product's transport look like it
belonged to a different product or environment. The Hub-minted trace identity
plus the caller-reference binding is the isolation boundary. When an operator
investigates an anomaly, the trace identity is trustworthy precisely because the
Hub, not the caller, established it.

## Four operational states

The Hub reports exactly four operational states: `AVAILABLE`, `DEGRADED`,
`UNAVAILABLE`, and `UNKNOWN`. These are transport states. They are not
compliance states and they are not certification states.

`AVAILABLE` means the Hub's own transport path is able to serve requests and its
mandatory dependencies are fresh and healthy within the configured freshness
window. `DEGRADED` means the Hub can still serve requests but at least one
optional dependency is unhealthy or a non-mandatory signal is stale, so the
transport is functioning with reduced assurance. `UNAVAILABLE` means a mandatory
dependency is failing or a mandatory signal is absent, so the Hub cannot honestly
claim it is able to serve the governed path. `UNKNOWN` means the Hub cannot
determine the state, typically because a mandatory probe is stale beyond the
freshness window or a probe threw without producing a trustworthy result.

The critical operational rule is that `UNKNOWN` is never treated as healthy. A
missing or stale signal is not evidence of health; it is evidence of missing
evidence. Readiness is fail-closed: when the Hub cannot prove a mandatory
dependency is fresh and healthy, it reports not-ready rather than assuming the
best. An operator who sees `UNKNOWN` should treat it exactly as they would treat
a suspected outage until the signal is restored, because the Hub itself refuses
to claim more than it can prove.

## What the Hub does not claim

The Hub's health and readiness output carries explicit non-claims. Readiness is
not certification: `READY` does not mean `CERTIFIED`. Health is not compliance:
`HEALTHY` does not mean `COMPLIANT`. A transport outcome is not a compliance
verdict: a successfully delivered request is `DELIVERED`, not `APPLIED`, and the
Hub never asserts that the Core applied anything. An approved change is not an
active change: `APPROVED` does not mean `ACTIVE`. A provisioned integration is
not a verified integration: `PROVISIONED` does not mean `VERIFIED`, and
`VERIFIED` does not mean `CERTIFIED`. These distinctions are enforced in code by
a compliance-vocabulary guard that rejects forbidden state words at the
projection boundary, and they are stated in the readiness response itself so that
no downstream consumer can mistake a transport signal for a compliance signal.

## Reading the telemetry

Operators read telemetry through the internal Convex operations and through the
service-facing endpoints. The `/v1/health` endpoint returns the operational
health projection. The `/readyz` endpoint returns the fail-closed readiness
decision with its reasons and non-claims. The `/v1/metrics` endpoint returns
Prometheus-format counters and gauges with bounded labels only; tenant,
product, trace, and correlation identifiers are never used as metric labels,
because unbounded label cardinality is both an operational hazard and a privacy
hazard. Trace-level detail is available through the internal trace query, which
returns the ordered observations for a correlation identity within the caller's
authorised scope.

Every internal operation is an `internalQuery` or `internalMutation`. There are
no public Convex observability functions. The observability surface is reachable
only through the Hub's own service layer, which applies authentication and
authorisation before any read or write reaches Convex. This is intentional: the
observability data is operationally sensitive, and exposing it directly through
public Convex functions would create an unauthorised read path around the Hub's
governance boundary.

## Retention

Observations are retained under a bounded retention policy. Each observation
carries an expiry derived from its retention class, and the purge operation
deletes only rows whose expiry has passed and whose expiry is actually present.
A row whose retention policy could not be resolved has no expiry and is never
treated as expired; it is retained and surfaced as a data-quality problem rather
than silently deleted. The purge operation is bounded per run so that it cannot
become an unbounded scan, and it counts only rows it actually deleted so that its
reported count reflects reality.

## Cross-chat dependency

The observability model depends on the governed transport contract that the Core
publishes. The Hub vendors the governed registry artifacts as references and
re-verifies them against Core main at each re-baseline. The Hub does not vendor
Core implementation, does not copy Core decision logic, and does not become a
second authority for any governed concern. When the Core's governed contract
changes materially, the Hub re-baselines before continuing; when the Core's
implementation changes without a governed-contract change, the Hub's transport
boundary is unaffected.
