# Runbook — Credential Revocation

## Purpose

This runbook describes how to revoke a service credential in the ARMA API Hub
control plane. Revocation is the immediate invalidation of a key reference so
that any request signed with it is rejected. Revocation is used when a
credential is suspected compromised, when a service is suspended or retired,
when a key is rotated out of its overlap window, or when a security incident
requires containment.

## What revocation does

Revocation sets the credential's state to REVOKED and records the revocation
time and reason. Once revoked, the credential fails the lifecycle check before
the signature is even verified, so any request signed with it is rejected with
`CREDENTIAL_REVOKED`. Revocation is immediate and does not depend on the
signature verification path.

## What revocation does not do

Revocation does not delete the credential record; the record is retained for
audit. Revocation does not revoke the service itself; a service may hold
multiple credentials, and revoking one does not affect the others. Revocation
does not remove key material from the secrets manager; the secrets manager
entry must be removed separately. Revocation does not stop in-flight requests
that were already admitted; those complete normally.

## Preconditions

Before revoking, confirm the key reference to revoke, the service that owns it,
and the reason for revocation. Confirm that the service has another valid
credential if it must continue operating, or that the service is intended to
stop operating. Confirm that the revocation is authorized by the service owner
or the security owner.

## Procedure

**Step 1 — Identify the key reference.** Determine the key identifier to
revoke. The control plane stores key references only; the key identifier is an
opaque reference, never the key material.

**Step 2 — Confirm ownership.** Confirm that the key reference belongs to the
expected service. A key reference must never be revoked across services.

**Step 3 — Check for an overlap window.** If the service is mid-rotation, the
retiring key may still be within its overlap window. Revoking it ends the
overlap immediately. Confirm that the new key is already active before ending
the overlap, or the service will be unable to sign.

**Step 4 — Revoke.** Revoke the credential with a reason. The credential state
becomes REVOKED and the revocation time and reason are recorded.

**Step 5 — Remove key material.** Remove the corresponding entry from the
secrets manager. The control plane does not hold key material, so this step is
performed in the secrets manager.

**Step 6 — Verify.** Confirm that a request signed with the revoked credential
is rejected with `CREDENTIAL_REVOKED`. Confirm that the service's other
credentials, if any, still verify.

**Step 7 — Record.** Record the revocation in the audit trail with the key
reference, the service, the reason, the authorizer, and the time.

## Rotation versus revocation

Rotation is the planned replacement of a credential. During rotation, both the
retiring and the new key verify within an overlap window, so rotation is
seamless. Revocation is the immediate invalidation of a credential outside the
planned rotation. A rotation that completes normally ends the overlap window
and retires the old key without an incident. A revocation is used when the
planned path is not safe.

## Emergency revocation

In an emergency, revoke first and investigate second. Revoke the suspected
credential, remove its key material from the secrets manager, and engage the
connector kill switch if the service must be stopped entirely. Then investigate
the incident, determine the blast radius, and rotate any other credentials that
may have been exposed.

## Verification checklist

After revocation, confirm: the credential state is REVOKED; a request signed
with it is rejected with `CREDENTIAL_REVOKED`; the key material is removed from
the secrets manager; the service's other credentials still verify; the
revocation is recorded in the audit trail; and, if the service was stopped
entirely, the connector kill switch is engaged.

## Related runbooks

See the connector kill-switch runbook for stopping a service entirely. See the
service onboarding guide for the credential provisioning step.
