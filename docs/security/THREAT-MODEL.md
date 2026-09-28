# Threat Model — ARMA API Hub

## Scope

This threat model covers the ARMA API Hub control plane: the service-facing
API, the durable worker, the operator console, the shared contracts, the
registry, service identity and credential lifecycle, event routing, webhook
delivery, retries and dead-letter handling, idempotency, signed receipts,
connector health, destination allow lists, rate limits, kill switches,
integration auditability, and the API Cost and Usage Guard (vendor price
versions, usage and cost records, rate-limit windows, quotas, budgets, spending
limits, anomalies, optimization decisions, cache, batch, and retry-waste
records, vendor shutdown controls, and cost-export receipts). It does not cover
the internal security of each FSTS product; each product owns its own threat
model, its own database, and its own security decisions.

## Assets

The assets the control plane protects are: service identities and their
credential references; signing key material (held only in the secrets manager,
never in the control plane); the registry of products, services, capabilities,
connections, and contract versions; event and webhook payloads; signed
receipts; idempotency and nonce registries; kill-switch state; connector health
reports; and the audit trail. The Cost and Usage Guard adds the vendor registry
and immutable vendor price versions, the usage and cost ledger, the rate-limit,
quota, budget, and spending-limit state, the anomaly and optimization records,
the cache, batch, and retry-waste records, the vendor shutdown state, and the
cost-export receipts. Customer data and product business records are
not assets of the control plane; they belong to the products and must never be
stored in the control plane. Vendor credentials are not assets of the control
plane either; the guard stores vendor references and price versions, never
vendor credentials.

## Trust boundaries

There are four trust boundaries. The first is between external callers and the
service-facing API: every request crossing it must be signed, and every
unsigned or malformed request must be rejected. The second is between the
control plane and each product: the control plane routes and records, but it
never reads a product's database and never makes a product's decisions. The
third is between the control plane and the secrets manager: key material
crosses this boundary by reference only. The fourth is between the browser or
mobile client and the control plane: no privileged credential may cross it.

## Threat analysis

### Spoofing

An attacker may attempt to impersonate a registered service by forging a
request. The control plane mitigates this with canonical request signing over
the method, exact path, timestamp, nonce, and byte-exact body hash, verified
with a timing-safe comparison. A forged signature fails verification. An
attacker may also attempt to replay a captured request; the nonce replay guard
consumes each nonce once within a bounded window, and the clock-skew window
rejects stale requests. An attacker may attempt to use a revoked or expired
credential; the credential lifecycle check rejects revoked and expired keys
before the signature is even verified.

### Tampering

An attacker may attempt to modify a request in flight. Because the signature
binds the exact path and the byte-exact body hash, any modification breaks
verification. An attacker may attempt to modify an event or a webhook delivery;
events are append-only facts with a payload hash, and webhook deliveries are
signed. An attacker may attempt to modify a signed receipt; the receipt carries
a hash of its own canonical body, so tampering is detectable. An attacker may
attempt to poison the idempotency or nonce registry with a partial write; both
registries are required to be enforced with unique indexes inside the same
transaction as the operation outcome.

### Repudiation

A service may deny having sent a request or an event. The control plane
mitigates this with signed requests, signed receipts, correlation and causation
identifiers, and an append-only audit trail. Every accepted request produces a
receipt that binds the delivery to its outcome without exposing the payload.

### Information disclosure

An attacker may attempt to read secrets, signatures, credentials, or protected
payloads from logs or telemetry. The control plane mitigates this with
structural redaction: an allow-list of safe metadata keys, a deny-list of
forbidden keys, and detection of registered secret values. Raw secrets,
signatures, credentials, and protected payloads can never reach a log line. An
attacker may attempt to read another tenant's data; tenant isolation is
enforced by policy, and a tenant-scoped request outside a service's authorized
tenant is denied. An attacker may attempt to infer internal topology from
health reports; health reports carry per-dependency status but no credentials
and no internal addresses.

### Denial of service

An attacker may attempt to exhaust the API or the worker. The control plane
mitigates this with rate limits, bounded retries, and dead-letter handling. An
attacker may attempt to burn a legitimate caller's nonce by sending a forged
request with that nonce; the control plane consumes a nonce only after the
signature is proven valid, so a forged request cannot burn a legitimate nonce.
An attacker may attempt to flood the queue with deliveries to a slow
subscriber; bounded retries and dead-lettering prevent unbounded growth.

### Elevation of privilege

An attacker may attempt to use a service's identity to perform an operation it
is not authorized for. The control plane mitigates this with scoped
capabilities: a service must hold the exact capability required for an
operation, in the correct direction, within the capability's classification
ceiling. A service that lacks the capability is denied. An attacker may attempt
to reach a destination that is not allow-listed; outbound requests must target
an approved, enabled connection. An attacker may attempt to use a browser or
mobile client to hold a privileged credential; the boundary forbids this, and
the SDK is documented as server-side only.

### Boundary violations

An attacker or a misconfigured product may attempt to make the control plane
approve a legal action, an evidence disclosure, a cannabis compliance decision,
a payment, an emergency dispatch, a security response, or an AI decision. The
boundary forbids this. The control plane routes and records these decisions but
never makes them; the relevant contracts carry explicit human-approval
requirements. A product may attempt to read another product's database; the
boundary forbids this, and cross-product data flows only through registered
contracts and events.

## Cost and usage threats

The Cost and Usage Guard introduces threats that are financial rather than
purely operational, and each is mitigated by construction.

An attacker or a buggy caller may attempt to record the same external charge
twice, inflating the recorded cost. The guard mitigates this by deduplicating on
both the cost-event identifier and the idempotency key inside the recording
transaction, so a duplicate cost event is rejected and a reused idempotency key
that maps to a different cost event is rejected as a conflict.

An attacker may attempt to tamper with a vendor price version to change the cost
of past or future usage. The guard mitigates this by making price versions
immutable and by resolving the price version that was effective at the request
time, so a later price change cannot retroactively rewrite history and a past
charge can always be explained.

An attacker may attempt to introduce a floating-point monetary value to exploit
rounding. The guard mitigates this by accepting only integer minor units and by
rejecting a non-integer or unsafe-integer input in the deterministic cost
primitives.

An attacker may attempt to bypass a spend limit or a vendor shutdown to keep
incurring cost. The guard mitigates this by evaluating the spending limit and the
shutdown state on the request path and by refusing the request when the limit is
throttling or blocking or when the vendor is shut down, regardless of budget or
quota headroom.

An attacker may attempt to read another tenant's or customer's cost. The guard
mitigates this by attributing cost to the tenant and to the authorized customer
reference and by indexing and reading cost by tenant and customer scope, so a
tenant-scoped read cannot return another tenant's cost.

An attacker may attempt to cache a protected or regulated response to avoid
cost. The guard mitigates this by denying a cache record for a protected or
regulated response that is not tenant-scoped, and by requiring that a cache be
tenant-scoped, encrypted where the classification requires it, and governed by
an approved retention policy.

An attacker may attempt to make the API Hub assert a profitability or margin
figure, or to make the AI Hub emit a second authoritative vendor charge, or to
make REGIVANTA re-measure vendor usage. The guard mitigates this by enforcing the
cost-ownership boundary in strict contracts that reject unknown fields, in
tables that have no column for margin or profit, and in deterministic tests that
assert the prohibited behaviors are rejected.

## Fail-closed posture

Every unknown condition fails closed. An unregistered service is denied. A
service that is not approved is denied. A service that is not in an active
lifecycle is denied. A service that lacks the required capability is denied. A
request that exceeds the capability's classification ceiling is denied. A
tenant-scoped request outside the authorized tenant is denied. An outbound
request to a non-allow-listed destination is denied. A service whose kill
switch is engaged is denied. Outbound delivery and connector delivery default
to disabled. A request that would incur cost with a vendor under an active
emergency shutdown is denied. A request that reaches a spending limit whose
action is throttle or block is denied. A cache record for a protected or
regulated response that is not tenant-scoped is denied. A cost event that
duplicates an existing cost-event identifier or idempotency key is denied.

## Residual risks

The control plane cannot protect against a compromised secrets manager, a
compromised product that holds a valid credential, or a compromised operator
account. It cannot protect against a product that mishandles its own customer
data. It cannot protect against a subscriber that accepts a webhook and then
mishandles it. These risks are owned by the relevant product or platform and
must be addressed in their own threat models. The control plane reduces their
blast radius by scoping capabilities, bounding retries, and keeping an audit
trail, but it does not eliminate them.

## Out of scope for Phase 0

Phase 0 does not connect to production, does not provision real credentials,
and does not deploy to production. The production database, queue, secrets
manager, deployment platform, and observability backend are deferred and must
each be threat-modeled before production.
