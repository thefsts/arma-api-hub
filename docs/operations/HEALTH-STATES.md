# Operations — Health States

## Purpose

This document defines the health and readiness semantics of the ARMA API Hub. It
explains the four operational states, how the Hub derives them, what each state
does and does not claim, and how an operator should respond to each. It is the
operational reference for the `/healthz`, `/readyz`, and `/v1/health` surfaces
and for the dependency-health snapshots that the Hub records.

The single most important rule in this document is that a health state is a
statement about the Hub's own ability to transport, not a statement about any
product's compliance. `HEALTHY` is not `COMPLIANT`, `READY` is not `CERTIFIED`,
and `UNKNOWN` is never treated as healthy. Everything else in this document
follows from those three distinctions.

## The four states

The Hub reports exactly four operational states: `AVAILABLE`, `DEGRADED`,
`UNAVAILABLE`, and `UNKNOWN`.

`AVAILABLE` means the Hub can honestly serve the governed transport path. Its
mandatory dependencies are present, fresh, and healthy within the configured
freshness window, and no optional dependency failure has been observed that would
warrant reduced assurance. This is the normal operating state.

`DEGRADED` means the Hub can still serve the governed path but with reduced
assurance. At least one optional dependency is unhealthy, or a non-mandatory
signal is stale, or a partial failure has been observed that does not prevent
serving but does reduce confidence. The transport works; the Hub is telling the
operator that it is working with a caveat.

`UNAVAILABLE` means the Hub cannot honestly serve the governed path. A mandatory
dependency is failing, or a mandatory signal is absent, or the Hub's own
transport pipeline is broken. In this state the Hub refuses to claim it can serve
and reports not-ready.

`UNKNOWN` means the Hub cannot determine the state. This happens when a mandatory
probe is stale beyond the freshness window, when a probe throws without producing
a trustworthy result, or when the evidence needed to classify the state is
missing. `UNKNOWN` is a distinct state, not a synonym for `UNAVAILABLE` and not a
soft form of `AVAILABLE`.

## Derivation from dependency probes

The Hub derives its operational state from a set of named dependency probes. Each
probe is declared mandatory or optional. A probe returns a result and an
observation timestamp. The Hub compares the timestamp against the freshness
window; a result older than the window is stale and is not treated as evidence of
health. The derivation then applies the following rules in order.

If any mandatory probe is stale beyond the freshness window, or any mandatory
probe throws without a trustworthy result, the state is `UNKNOWN` and readiness is
not-ready. If any mandatory probe reports failure, the state is `UNAVAILABLE` and
readiness is not-ready. If all mandatory probes are fresh and healthy but at least
one optional probe is failing or stale, the state is `DEGRADED` and readiness is
ready with a caveat. If all probes are fresh and healthy, the state is
`AVAILABLE` and readiness is ready. The ordering is deliberate: a stale mandatory
signal produces `UNKNOWN` rather than `UNAVAILABLE`, because the Hub genuinely
does not know whether the dependency is down, and it would rather say so than
guess.

## Fail-closed readiness

Readiness is fail-closed. The default assumption is that the Hub is not ready
until it can prove otherwise. The `/readyz` endpoint returns a non-ready status
when the derived state is `UNAVAILABLE` or `UNKNOWN`, and it returns a ready
status only when the derived state is `AVAILABLE` or `DEGRADED`. The response
includes the derived state, the environment, the reasons for the decision, and
explicit non-claims. It also includes the outbound-delivery flag, because
outbound delivery is disabled by default and enabled only for explicitly
registered, approved, active, and un-killed connectors. A Hub that is ready to
serve inbound requests is not necessarily enabled to deliver outbound, and the
response makes that distinction visible rather than hiding it behind a single
boolean.

The non-claims are part of the response on purpose. A readiness response is one
of the most likely signals to be consumed by an orchestrator, a dashboard, or a
downstream system, and any of those consumers could mistakenly read "ready" as
"compliant" if the response did not say otherwise. The Hub states
`complianceClaim: NONE` and `certificationClaim: NONE` in the response so that the
non-claim travels with the signal.

## Dependency health snapshots

The Hub records dependency-health snapshots so that the state of a dependency can
be examined over time rather than only in the moment. A snapshot records the
dependency identity, its type, whether it is mandatory, the raw counters the Hub
observed, the derived state, the source of the evidence, and the observation
time. The Hub records raw counters rather than only the derived state, because a
derived state without its inputs cannot be audited or recomputed. The snapshot
store is indexed by dependency and time and by environment and time, so that an
operator can reconstruct what the Hub believed and why at any point.

The Hub does not accept a caller-asserted state or a caller-asserted source. A
caller may report raw counters; the Hub derives the state and the source itself.
This prevents a caller from asserting `HEALTHY` and having the Hub record it as
fact. The derivation uses a fixed window size, a minimum sample count, and
failure-rate thresholds so that a single bad sample does not flip the state and a
genuinely failing dependency is not masked by a small number of good samples.

## Relationship to kill switch and rollout

Health and the kill switch are independent controls. The kill switch is evaluated
before and independently of health, so a killed connector is blocked regardless
of how healthy its dependency appears. A dependency that is healthy does not
override a kill switch, and a kill switch does not imply that the dependency is
unhealthy. When an operator sees a blocked rollout, they should check the kill
switch and the rollout controls before concluding that the dependency is down,
because the block may be a deliberate control action rather than a failure.

## Operator response

On `AVAILABLE`, no action is required beyond normal monitoring. On `DEGRADED`, the
operator should identify the optional dependency or stale signal, confirm that the
governed path is still serving correctly, and decide whether to remediate
immediately or to monitor. On `UNAVAILABLE`, the operator should treat the
governed path as down, identify the failing mandatory dependency, and follow the
relevant runbook. On `UNKNOWN`, the operator should treat the state as a suspected
outage until the missing evidence is restored, because the Hub cannot prove health
and will not pretend to.

In every case, the operator must remember that the health state describes the
Hub's transport, not a product's compliance. A product's compliance posture is
decided by the Core through the governed path. The Hub's health tells the operator
whether the Hub can carry that decision, not what the decision is.
