# Runbook — Emergency Vendor Shutdown

## Purpose

This runbook describes how to activate and release an emergency vendor shutdown
in the ARMA API Hub control plane. A vendor shutdown is the control-plane
mechanism that stops all external usage of a vendor immediately. It is used when
a vendor is misbehaving, when a vendor is suspected compromised, when a vendor's
pricing or terms have changed in a way that must halt usage, when a downstream
system must be isolated during an incident, or when a regulatory or compliance
obligation requires that no further cost be incurred with a vendor.

## What a vendor shutdown does

A vendor shutdown sets the shutdown state for a vendor to active. While active,
the control plane refuses any request that would incur cost with that vendor,
regardless of budget or quota headroom. The shutdown takes effect on the next
request and does not require a redeploy. The shutdown is recorded with its
scope, its reason, its authorizer, and its time, and it writes an audit event.

## What a vendor shutdown does not do

A vendor shutdown does not delete queued work; work that was already accepted
remains in the queue and is held, not discarded. A vendor shutdown does not
revoke credentials; a vendor under shutdown may still hold a valid credential,
and credential revocation is a separate action. A vendor shutdown does not stop
inbound requests to the service-facing API; it governs outbound spend only. A
vendor shutdown does not modify the vendor's account; it only stops the control
plane from incurring further cost with the vendor. A vendor shutdown does not
replace the connector kill switch; the kill switch stops outbound delivery, and
the shutdown stops outbound spend, and both may be needed.

## Preconditions

Before activating a vendor shutdown, confirm the vendor, the reason, and the
authorizer. Confirm whether the intent is to pause usage (releasable) or to
isolate the vendor pending investigation (releasable only after review). Confirm
that holding queued work is acceptable, or that the queue must be drained to the
dead-letter store instead. Confirm that the decision is authorized by the vendor
owner or the security owner. Confirm whether the connector kill switch must also
be engaged, because a vendor shutdown stops spend but does not stop delivery.

## Procedure

**Step 1 — Identify the vendor.** Determine the vendor to shut down. A vendor
shutdown is vendor-scoped; it stops all connectors and systems that use the
vendor.

**Step 2 — Confirm the scope of impact.** Identify every connector, system,
tenant, and customer that uses the vendor, so the blast radius is known before
the shutdown is activated.

**Step 3 — Activate.** Set the shutdown state to active with a reason. The state
change is recorded with the authorizer and the time. Requests that would incur
cost with the vendor are refused on the next attempt.

**Step 4 — Decide the queue disposition.** Choose whether queued work is held
for later processing or drained to the dead-letter store. Holding is appropriate
when the pause is expected to be short and the work remains valid. Draining is
appropriate when the work is time-sensitive, when the vendor may have partially
processed it, or when the work must be re-evaluated before it is sent.

**Step 5 — Verify.** Confirm that a request to the shut-down vendor is refused
and that the refusal is recorded. Confirm that other vendors are unaffected.

**Step 6 — Notify.** Notify the vendor owner, the security owner, and the owners
of the affected connectors and systems that the shutdown is active, with the
vendor, the reason, the blast radius, and the expected duration.

**Step 7 — Record.** Record the activation in the audit trail with the vendor,
the reason, the authorizer, the time, and the queue disposition.

## Releasing the shutdown

Release only after the reason for the shutdown has been resolved. Confirm that
the vendor is healthy, that any incident is closed, and that the vendor's pricing
and terms are still acceptable. Release the shutdown, then confirm that usage
resumes and that held work is processed in order. If the queue was drained,
confirm that the drained work is re-queued deliberately rather than replayed
blindly, because a vendor that partially processed a request may reject or
duplicate it. Record the release in the audit trail with its authorizer and time.

## Interaction with spend limits and the kill switch

A vendor shutdown overrides spend limits: while the shutdown is active, a
request is refused even if the connector is within its budget and quota. The
shutdown and the connector kill switch are complementary. The kill switch stops
outbound delivery to a connector; the vendor shutdown stops outbound spend with
a vendor. When a vendor is compromised, engage both: the kill switch contains
the outbound delivery path, and the shutdown contains the outbound spend path.
When the incident is not yet understood, engage both and investigate second.

## Emergency shutdown

In an emergency, activate the vendor shutdown first and investigate second.
Activate the shutdown for the affected vendor, then determine which connectors
and systems are affected and whether any credentials must also be revoked. The
shutdown contains the spend path; credential revocation contains the inbound
path. Use both when the incident is not yet understood.

## Verification checklist

After activating a vendor shutdown, confirm: the shutdown state is active for
the intended vendor; a request to the vendor is refused and recorded; other
vendors are unaffected; the queue disposition is recorded; the vendor owner,
security owner, and affected connector and system owners are notified; and the
activation is recorded in the audit trail. After releasing, confirm: the
shutdown state is released; usage resumes; held work is processed in order; and
the release is recorded in the audit trail.

## Related runbooks

See the vendor spend limit runbook for bounding spend without a full shutdown.
See the connector kill-switch runbook for stopping outbound delivery. See the
credential revocation runbook for invalidating a credential.
