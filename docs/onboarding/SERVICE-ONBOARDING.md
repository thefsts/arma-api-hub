# Service Onboarding Guide — ARMA API Hub

## Purpose

This guide describes how a service is onboarded onto the ARMA API Hub control
plane. Onboarding is the process by which a product, client system, or partner
becomes a registered, approved, active participant with a scoped identity, a
credential, and a set of capabilities. The hard rule is simple: a service must
not send or receive protected events unless it is registered, approved, active,
and assigned the required scoped capability.

## Who onboards

Three kinds of participants onboard. FSTS-owned products onboard as
FSTS-owned services. Approved external or client systems onboard as
client-owned services. Approved partners onboard as partner-owned services.
Ownership is explicit and is never inferred. PlayRaise is a client-owned
integration and must never be classified as FSTS-owned.

## Lifecycle

Every service moves through a lifecycle: DRAFT, DEVELOPMENT, TEST, PILOT,
ACTIVE, PAUSED, DEPRECATED, RETIRED. A service may send or receive protected
events only in the PILOT and ACTIVE states. Onboarding status is tracked
separately and takes the values NOT_STARTED, IN_REVIEW, APPROVED, REJECTED, and
SUSPENDED. A service may send or receive protected events only when its
onboarding status is APPROVED.

## Onboarding steps

**Step 1 — Registration.** The owning team registers the service with a
service identifier, a display name, the owning product, the ownership
classification, the environment, the owner, the data classification, and the
initial set of capabilities. Registration creates a DRAFT service record.

**Step 2 — Capability scoping.** The owning team declares the capabilities the
service needs, each with a direction, a maximum classification, and whether it
requires an explicit approval record. Capabilities are scoped: a service may
exercise a capability only in the declared direction and only within the
declared classification ceiling.

**Step 3 — Connection declaration.** For each outbound destination, the owning
team declares a connection with the remote service, the governing contract, the
capabilities exercised over it, the classification carried, and whether it is
enabled. Outbound requests are allowed only to approved, enabled connections.

**Step 4 — Contract agreement.** The owning team and the counterparty agree on
the contract versions the service produces and consumes. Contracts are
versioned and may be deprecated with a sunset date and a replacement.

**Step 5 — Security review.** The security owner reviews the service's data
classification, tenant scope, destination allow list, and kill-switch plan. The
review confirms that the service does not require the control plane to make a
legal, compliance, payment, dispatch, security, or AI decision.

**Step 6 — Credential provisioning.** A credential is provisioned through the
secrets manager. The control plane stores only the key reference and its
lifecycle state. The key material never enters the control plane.

**Step 7 — Approval.** The onboarding status is set to APPROVED and the
lifecycle is advanced to PILOT or ACTIVE. Only now may the service send or
receive protected events.

**Step 8 — Verification.** The service is verified against the control plane
using synthetic data in a non-production environment before any production
traffic.

## Requirements for approval

A service is approved only when it has a named owner, an explicit ownership
classification, a data classification, a tenant scope where applicable, a
declared set of capabilities, declared connections for every outbound
destination, agreed contract versions, a credential reference, a kill-switch
plan, and a security review that confirms the boundary is respected.

## Tenant scope

A service that handles tenant-scoped data must declare the tenant or
organization identifiers it is authorized to operate within. A request carrying
a tenant outside that scope is denied. A REGULATED service must carry an
explicit tenant on every request.

## What the control plane does not do

The control plane does not approve legal actions, evidence disclosure, cannabis
compliance, payments, emergency dispatch, security responses, or AI decisions.
A service that needs one of these decisions must obtain it from the responsible
human or product; the control plane routes and records the decision but never
makes it. Contracts that represent such decisions carry explicit human-approval
requirements.

## Suspension and retirement

A service may be suspended (onboarding status SUSPENDED) or paused (lifecycle
PAUSED) at any time. A suspended or paused service may not send or receive
protected events. A service may be retired (lifecycle RETIRED) when it is no
longer needed; its credential is revoked and its connections are disabled.

## Checklist

Before a service is approved, confirm: the owner is named; the ownership
classification is explicit and correct; the data classification is set; the
tenant scope is declared where applicable; every capability is scoped with a
direction and a ceiling; every outbound destination has an enabled connection;
contract versions are agreed; a credential reference exists; a kill-switch plan
exists; and the security review confirms the boundary is respected.
