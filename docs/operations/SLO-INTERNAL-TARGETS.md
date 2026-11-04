# Operations — Internal SLO Targets

## Purpose

This document defines the internal service-level objectives that the ARMA API
Hub uses to operate its transport path. These objectives are internal
operational targets. They are not contractual service-level agreements, they are
not compliance requirements, and they are not certification criteria. They exist
so that operators have a shared, measurable notion of whether the transport is
behaving as intended, and so that degradation is detected before it becomes an
outage. Nothing in this document creates an obligation to a customer, a
regulatory body, or a certification auditor, and nothing here should be quoted as
a guarantee.

The distinction matters because the Hub sits inside a compliance architecture. A
transport objective that was mistaken for a compliance requirement would let a
latency number masquerade as a control. The Hub's position is the opposite: SLOs
measure transport quality, the Core decides compliance, and the two are never
conflated.

## What an SLO window is

An SLO window is a bounded aggregation of transport observations over a defined
time range for a defined scope. The Hub computes SLO windows from the
append-oriented observation stream rather than from a separate counter store, so
that the window is always reconcilable to the observations that produced it. A
window records the observation count, the success count, the failure count, the
retryable failure count, the terminal failure count, the latency distribution
summary, and the derived availability and error-budget figures. A window is a
derived view; it is not a new source of truth, and it can be recomputed from the
underlying observations.

Windows are computed by an internal mutation and read by an internal query. They
are scoped to a service and, where relevant, to a product, tenant, and
environment. The computation is bounded so that a window cannot trigger an
unbounded scan, and the window size is fixed so that two operators looking at the
same scope and period see the same aggregation.

## The internal targets

The Hub maintains internal targets for three transport qualities: availability of
the governed path, latency of the governed path, and the rate of terminal
failures that are attributable to the Hub rather than to a caller or a
dependency. Availability is measured as the proportion of governed requests that
receive a transport outcome rather than an infrastructure failure. Latency is
measured at the transport boundary and excludes time spent inside the Core's
decision logic, because the Hub does not own and cannot honestly promise the
Core's processing time. Terminal-failure rate is measured against the governed
failure taxonomy so that a caller error and a Hub defect are counted separately.

Each target is expressed as an objective over a rolling window with an associated
error budget. The error budget is the amount of imperfection the target tolerates
before the objective is considered breached. When the error budget for a target is
exhausted, the operational response is to slow risky changes and investigate,
not to redefine the target. Targets are reviewed on a regular cadence and may be
adjusted as the system matures, but an adjustment is a deliberate operational
decision recorded as such, never a quiet relaxation to make a dashboard green.

## How targets relate to health states

The internal targets and the four operational states are related but not
identical. The operational state answers whether the Hub can honestly serve the
governed path right now. An SLO target answers whether the Hub has been serving
it well over a window. A Hub can be `AVAILABLE` in the moment while trending
toward an SLO breach, and a Hub can be `DEGRADED` in the moment without yet
having breached a windowed objective. Operators use the state for immediate
decisions and the SLO windows for trend and budget decisions. Neither signal
overrides the other, and neither is a compliance signal.

## Fail-closed interaction

SLO computation is fail-closed in the same sense as readiness. If the observation
stream is incomplete, if a window cannot be computed from trustworthy inputs, or
if a mandatory signal is missing, the Hub reports the window as indeterminate
rather than reporting a favourable number. An indeterminate window is treated as
a data-quality incident, because an SLO that is computed from missing evidence is
worse than no SLO at all: it invites a false sense of control. The Hub would
rather tell an operator that it does not know than tell them that everything is
fine when it cannot prove it.

## Reporting

SLO windows are surfaced through the internal query surface and summarised in the
metrics endpoint as bounded aggregates. They are not exposed through public
Convex functions, and they do not carry tenant, product, trace, or correlation
identifiers as metric labels. When an operator needs per-scope detail, they use
the internal query within their authorised scope rather than a high-cardinality
metric. This keeps the metrics surface operationally useful and keeps
tenant-identifying data out of the metrics pipeline.

## What these targets are not

These targets are not SLAs. They are not contractual commitments, they are not
warranties, and they are not representations to any customer about the behaviour
of the service. They are not compliance requirements, they are not controls, and
they are not evidence for any certification. They are not a substitute for the
Core's decisions about a product's compliance posture. An operator or auditor who
needs to know whether a product is compliant must ask the Core, through the
governed path, and must not infer compliance from a green SLO dashboard. The Hub
will always be explicit about this boundary, because the integrity of the whole
architecture depends on no transport metric ever being mistaken for a compliance
fact.
