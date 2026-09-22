# Runbook — Connector Kill Switch

## Purpose

This runbook describes how to engage and release the connector kill switch in
the ARMA API Hub control plane. The kill switch is the control-plane mechanism
that stops outbound delivery to a connector or to all connectors. It is used
when a destination is misbehaving, when a destination is suspected compromised,
when a downstream system must be isolated during an incident, or when a
regulatory or compliance obligation requires that no further events leave the
control plane.

## What the kill switch does

The kill switch sets the kill-switch state for a connector, or for the whole
control plane, to engaged. While engaged, the delivery path refuses to hand any
event to the destination. Outbound delivery is fail-closed: the default state of
the control plane is that outbound delivery is disabled, and delivery is enabled
only for connectors that are explicitly registered, approved, active, and not
killed. Engaging the kill switch therefore takes effect on the next delivery
attempt and does not require a redeploy.

## What the kill switch does not do

The kill switch does not delete queued jobs; jobs that were already accepted
remain in the queue and are held, not discarded, so that they can be delivered
after the switch is released if that is the correct decision. The kill switch
does not revoke credentials; a killed connector may still hold a valid
credential, and credential revocation is a separate action. The kill switch
does not stop inbound requests to the service-facing API; it governs outbound
delivery only. The kill switch does not modify the destination system; it only
stops the control plane from sending to it.

## Preconditions

Before engaging the kill switch, confirm the connector or scope to kill, the
reason, and the authorizer. Confirm whether the intent is to pause delivery
(releasable) or to isolate the destination pending investigation (releasable
only after review). Confirm that holding queued jobs is acceptable, or that the
queue must be drained to the dead-letter store instead. Confirm that the
decision is authorized by the connector owner or the security owner.

## Procedure

**Step 1 — Identify the scope.** Determine whether the kill switch applies to a
single connector or to the whole control plane. A single-connector kill is the
default; a control-plane-wide kill is reserved for broad incidents.

**Step 2 — Confirm the destination.** Confirm the connector's registered
destination against the destination allow list. A kill switch must never be
engaged against an unregistered destination, because an unregistered
destination should already be refused by the allow list.

**Step 3 — Engage.** Set the kill-switch state to engaged with a reason. The
state change is recorded with the authorizer and the time. Delivery to the
destination is refused on the next attempt.

**Step 4 — Decide the queue disposition.** Choose whether queued jobs are held
for later delivery or drained to the dead-letter store. Holding is appropriate
when the pause is expected to be short and the events remain valid. Draining is
appropriate when the events are time-sensitive, when the destination may have
partially processed them, or when the events must be re-evaluated before
delivery.

**Step 5 — Verify.** Confirm that a delivery attempt to the killed connector is
refused and that the refusal is recorded. Confirm that other connectors are
unaffected when the kill is scoped to a single connector.

**Step 6 — Notify.** Notify the connector owner and the security owner that the
kill switch is engaged, with the scope, the reason, and the expected duration.

**Step 7 — Record.** Record the engagement in the audit trail with the scope,
the connector, the reason, the authorizer, the time, and the queue disposition.

## Releasing the kill switch

Release only after the reason for the kill has been resolved. Confirm that the
destination is healthy, that any incident is closed, and that the connector
still satisfies the registration, approval, lifecycle, and capability
requirements for the events it will receive. Release the kill switch, then
confirm that delivery resumes and that held jobs are delivered in order. If the
queue was drained, confirm that the drained events are re-queued deliberately
rather than replayed blindly, because a destination that partially processed an
event may reject or duplicate it.

## Interaction with retries and the dead-letter store

While the kill switch is engaged, delivery attempts are refused before the
retry schedule is consumed, so the retry budget is not spent on a destination
that cannot receive. When the switch is released, held jobs resume their retry
schedule from where they were held. Jobs that exhaust their retry budget are
moved to the dead-letter store with their failure class, so that a
CLEAN_RETRYABLE failure can be retried safely, an AMBIGUOUS failure is held for
review, and a TERMINAL failure is not retried.

## Emergency kill

In an emergency, engage the kill switch first and investigate second. Engage the
kill switch for the affected connector, or for the whole control plane if the
blast radius is unknown, then determine which destinations are affected and
whether any credentials must also be revoked. The kill switch contains the
outbound path; credential revocation contains the inbound path. Use both when
the incident is not yet understood.

## Verification checklist

After engaging the kill switch, confirm: the kill-switch state is engaged for
the intended scope; a delivery attempt to the killed connector is refused and
recorded; other connectors are unaffected when the kill is scoped; the queue
disposition is recorded; the connector owner and security owner are notified;
and the engagement is recorded in the audit trail. After releasing, confirm:
the kill-switch state is released; delivery resumes; held jobs are delivered in
order; and the release is recorded in the audit trail.

## Related runbooks

See the credential revocation runbook for invalidating a credential. See the
service onboarding guide for the registration, approval, and capability steps
that a connector must satisfy before delivery is permitted.
