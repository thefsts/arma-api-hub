# Data Classification Standard — ARMA API Hub

## Purpose

Every payload that crosses the control plane carries an explicit data
classification. The classification determines the maximum sensitivity a
capability may carry and drives the fail-closed policy decision. This standard
defines the five classification levels, their ordering, their handling rules,
and how they map to capabilities and connections.

## Levels

The control plane defines five levels, ordered from least to most sensitive:

**PUBLIC.** Information that may be disclosed without harm. Examples include
published documentation and public status information. PUBLIC data may be
carried by any capability.

**INTERNAL.** Information intended for FSTS personnel and systems but not for
public disclosure. Examples include internal service metadata and non-sensitive
operational telemetry. INTERNAL data may be carried by capabilities whose
ceiling is INTERNAL or higher.

**CONFIDENTIAL.** Information whose disclosure could harm FSTS or its clients.
Examples include service configuration, contract metadata, and non-regulated
operational records. CONFIDENTIAL data may be carried by capabilities whose
ceiling is CONFIDENTIAL or higher.

**PROTECTED.** Information whose disclosure could cause significant harm,
including safety-relevant operational signals. Examples include panic and
emergency-routing signals. PROTECTED data may be carried only by capabilities
whose ceiling is PROTECTED or higher.

**REGULATED.** Information subject to legal or regulatory obligations, or whose
handling is legally constrained. Examples include cannabis compliance records,
custody records, and regulated transaction status. REGULATED data may be
carried only by capabilities whose ceiling is REGULATED, and it requires an
explicit tenant scope.

## Ordering and enforcement

The levels are totally ordered: PUBLIC is less sensitive than INTERNAL, which
is less sensitive than CONFIDENTIAL, which is less sensitive than PROTECTED,
which is less sensitive than REGULATED. A capability declares a maximum
classification. A request whose declared classification exceeds the
capability's ceiling is denied with `CLASSIFICATION_EXCEEDED`. This comparison
is performed by rank, so a capability with a CONFIDENTIAL ceiling cannot carry
PROTECTED or REGULATED data.

## Handling rules

Data at every level is subject to the following rules. Raw secrets, signatures,
credentials, and protected payloads must never be logged; the observability
layer enforces this structurally. Payloads are referenced by hash, not by
content, in envelopes, receipts, and audit records. Data at CONFIDENTIAL and
above must be carried only over authenticated, signed channels. Data at
PROTECTED and above must additionally be subject to destination allow-listing.
Data at REGULATED must additionally carry an explicit tenant scope, and a
tenant-scoped request outside the service's authorized tenant is denied.

Cost data follows the same handling rules and adds two of its own. A cost record
that carries a customer reference must be readable only within the authorized
tenant or customer scope, and a tenant-scoped cost read must not return another
tenant's cost. A protected or regulated response must not be cached unless the
contract explicitly allows caching, the cache is tenant-scoped, the cache is
encrypted where the classification requires it, and the cache is governed by an
approved retention policy; a cache record for a protected or regulated response
that is not tenant-scoped is denied.

## Mapping to capabilities and connections

A capability declares its direction (inbound, outbound, or bidirectional), its
maximum classification, and whether it requires an explicit approval record. A
connection declares the contract that governs it, the capabilities exercised
over it, the classification it carries, and whether it is enabled. A service
may exercise a capability only if it holds that capability, in the correct
direction, within the classification ceiling, and — for outbound requests —
only to an approved, enabled connection.

## Tenant scope

Tenant isolation is enforced at the policy layer. A service may declare the
tenant or organization identifiers it is authorized to operate within. When a
service declares an authorized tenant scope and a request carries a tenant
outside that scope, the request is denied with `TENANT_MISMATCH`. When a
service is classified REGULATED and a request omits the tenant, the request is
denied with `TENANT_REQUIRED`. When a service does not declare a tenant scope,
tenant isolation is the responsibility of the owning product, and the control
plane does not infer a scope.

## Classification of the control plane's own records

The control plane's own records are classified as follows. The registry of
products, services, capabilities, and connections is INTERNAL. Contract
metadata is INTERNAL. Credential references and their lifecycle state are
CONFIDENTIAL. Signed receipts and audit records are CONFIDENTIAL. Connector
health reports are INTERNAL. Kill-switch state is CONFIDENTIAL. No control
plane record is classified above CONFIDENTIAL except where it references a
REGULATED payload by hash, in which case the reference inherits the payload's
classification.

The Cost and Usage Guard's records are classified as follows. The vendor
registry and vendor price versions are INTERNAL. Usage records and cost events
are CONFIDENTIAL, because they carry commercial pricing and, where authorized, a
tenant or customer reference. Rate-limit, quota, budget, and spending-limit
state is CONFIDENTIAL. Anomaly and optimization records are INTERNAL. Cache,
batch, and retry-waste records are CONFIDENTIAL. Vendor shutdown state is
CONFIDENTIAL. Cost-export receipts are CONFIDENTIAL. A cost record that carries
a customer reference is CONFIDENTIAL and is readable only within the authorized
tenant or customer scope. No cost record is classified above CONFIDENTIAL, and
no cost record carries a profitability or margin figure, because those belong to
REGIVANTA and never cross into the control plane.

## Prohibited content

The control plane must never store customer data, product business records,
LawShield evidence, cannabis regulator credentials, production infrastructure
details, or real security incident records. These belong to the products and
must never cross into the control plane. Payloads are referenced by hash so
that even the control plane's own records do not carry protected content.
