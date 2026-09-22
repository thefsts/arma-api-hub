# Runbook — Vendor Spend Limit

## Purpose

This runbook describes how to configure, monitor, and act on a vendor spend
limit in the ARMA API Hub control plane. A spend limit is the control-plane
mechanism that bounds how much a connector, a vendor, a system, a tenant, or an
authorized customer may spend on external usage within a period. It is used to
keep a runaway integration from consuming an unbounded budget, to enforce a
customer's contracted ceiling, to throttle a connector that is approaching its
limit, and to hard-block a connector that has reached it.

## What a spend limit does

A spend limit tracks spend against a limit and takes one of three actions when
the limit is reached. The warn action records the breach and allows the request,
so the operator is notified without interrupting service. The throttle action
records the breach and refuses the request with a throttled status, so the
connector is slowed but not stopped. The block action records the breach and
refuses the request with a blocked status, so the connector is stopped until the
limit is raised or the period resets. Every warning, throttle, and block writes
an audit event, so the control history is complete and reviewable.

## What a spend limit does not do

A spend limit does not delete queued work; work that was already accepted
remains in the queue and is held, not discarded. A spend limit does not revoke
credentials; a throttled or blocked connector may still hold a valid credential,
and credential revocation is a separate action. A spend limit does not modify
the vendor's account; it only stops the control plane from incurring further
cost with that vendor. A spend limit does not override an emergency vendor
shutdown; a shutdown stops all usage of a vendor regardless of budget headroom.

## Preconditions

Before configuring a spend limit, confirm the scope — connector, vendor, system,
tenant, or authorized customer — the period, the limit amount in minor currency
units, the currency, and the action. Confirm that the limit is authorized by the
connector owner or the budget owner. Confirm that the action is appropriate for
the scope: warn for a soft ceiling that should notify but not interrupt, throttle
for a connector that should be slowed, and block for a hard ceiling that must not
be exceeded. Confirm that the limit is expressed in integer minor units and that
the currency matches the vendor's billing currency.

## Procedure

**Step 1 — Identify the scope.** Determine whether the limit applies to a single
connector, a vendor, a system, a tenant, or an authorized customer. A
connector-scoped limit is the default for a single integration; a vendor-scoped
limit bounds all usage of a vendor; a tenant- or customer-scoped limit enforces
a contracted ceiling.

**Step 2 — Confirm the period.** Confirm the billing period the limit applies
to. A limit is evaluated against the spend recorded in the period, so the period
must match the vendor's billing cadence.

**Step 3 — Set the limit.** Create the spend limit with its scope, period, limit
amount in minor units, currency, and action. The limit is recorded with its
authorizer and its time.

**Step 4 — Verify the threshold.** Confirm that a request below the limit is
allowed, that a request at the warning threshold records a warning, that a
request at a throttle limit is refused with a throttled status, and that a
request at a block limit is refused with a blocked status. Confirm that each
outcome writes an audit event.

**Step 5 — Notify.** Notify the connector owner and the budget owner that the
limit is in place, with the scope, the period, the amount, and the action.

**Step 6 — Record.** Record the configuration in the audit trail with the scope,
the period, the amount, the currency, the action, the authorizer, and the time.

## Monitoring

Monitor spend against each limit through the budget and spending-limit reads,
which are indexed by budget status and by scope and period. A limit that is
repeatedly warning is a signal that the limit is too low or that the connector is
consuming more than expected. A limit that is repeatedly throttling is a signal
that the connector is at its ceiling and that either the limit must be raised or
the connector's usage must be reduced. A limit that is blocking is a signal that
the connector has reached a hard ceiling and that the cause must be understood
before the limit is raised.

## Raising or lowering a limit

Raise a limit only after the cause of the breach is understood and the increase
is authorized. Lower a limit only after confirming that the connector can
operate within the lower limit or that the reduction is intentional. A change to
a limit is recorded with its authorizer and its time, and it takes effect on the
next evaluation. A change to a limit does not retroactively change the spend
already recorded in the period.

## Interaction with retries and the dead-letter store

While a connector is throttled or blocked, requests are refused before the retry
schedule is consumed, so the retry budget is not spent on a connector that
cannot incur cost. When the limit is raised or the period resets, held work
resumes. Work that exhausts its retry budget is moved to the dead-letter store
with its failure class, so that a clean retryable failure can be retried safely,
an ambiguous failure is held for review, and a terminal failure is not retried.

## Emergency spend stop

In an emergency, block the connector or activate the emergency vendor shutdown
first and investigate second. A block stops the connector; a vendor shutdown
stops all usage of the vendor. Use the block when the blast radius is a single
connector and the vendor shutdown when the blast radius is the vendor. Use both
when the incident is not yet understood.

## Verification checklist

After configuring a spend limit, confirm: the limit is recorded with its scope,
period, amount, currency, and action; a request below the limit is allowed; a
request at the warning threshold records a warning; a request at a throttle
limit is refused with a throttled status; a request at a block limit is refused
with a blocked status; each outcome writes an audit event; and the connector
owner and budget owner are notified. After raising or lowering a limit, confirm:
the change is recorded with its authorizer and time; the change takes effect on
the next evaluation; and the spend already recorded in the period is unchanged.

## Related runbooks

See the emergency vendor shutdown runbook for stopping all usage of a vendor.
See the connector kill-switch runbook for stopping outbound delivery. See the
credential revocation runbook for invalidating a credential.
