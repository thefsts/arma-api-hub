# API Cost and Usage Guard — ARMA API Hub

## Purpose

The API Cost and Usage Guard is the part of the ARMA API Hub that measures what
external APIs, connectors, and webhooks cost, attributes that cost to the FSTS
system, tenant, or authorized customer that caused it, and enforces the controls
that keep that cost inside its limits. It is the authoritative source for the
charge a vendor levies for an external request, a connector operation, a webhook
delivery, a retry, a byte transferred, or a byte stored on behalf of an external
integration. It is not the source of truth for company profitability; that
belongs to REGIVANTA, as recorded in the cost-ownership boundaries document.

The guard exists because external usage is where a control plane can quietly
accumulate cost: a retry storm against a flaky vendor, a webhook that is
redelivered thousands of times, a connector that is left subscribed after it is
no longer used, a batch job that is run in real time when it could be batched, a
cache that is never consulted. Each of these is measurable, and each of them is
governable. The guard measures them, records them with exact monetary
arithmetic, and enforces the limits that stop them.

## What the guard measures

The guard measures cost per API request, per connector, per external vendor, and
per FSTS system. It attributes cost to a tenant or to an authorized customer
reference where the contract permits. It tracks subscription and usage-tier
limits, rate-limit consumption, retry and failure waste, duplicate-request cost,
webhook delivery and redelivery cost, data-transfer cost, API-related storage
cost, batch-versus-realtime savings, and cache savings. It tracks vendor price
versions, monthly API and vendor forecasts, API and vendor cost anomalies,
customer quotas and overages, connector-level spending limits, and emergency
vendor shutdown controls.

## Exact monetary arithmetic

Money is never stored as a floating-point number. Every monetary amount is an
integer in minor currency units — cents for a currency with two minor digits —
and every calculation is performed on integers. The deterministic cost
primitives reject a non-integer or unsafe-integer input rather than rounding it,
so a fractional cent can never enter the ledger. This is a hard rule: a
floating-point monetary value is a defect, and the tests assert that the
primitives refuse one.

Every calculated amount records the currency, the quantity, the unit type, the
unit price, the pricing source, the vendor price version, the effective date,
the calculation version, and whether the amount is estimated or finalized. The
estimated-versus-finalized status matters because a vendor may bill on a
different cadence than the request: an amount is estimated when it is computed
from the current price version at request time, and it becomes finalized when
the vendor's invoice confirms it. The guard never overwrites historical usage
with a new vendor price; it preserves the price version that applied when the
request occurred, so a later price change cannot retroactively rewrite history.

## Vendor price versions

A vendor price is immutable once it is recorded. Each price version carries a
vendor, a unit type, a unit price in minor units, a currency, a pricing source,
an effective-from date, and an optional effective-to date. When the guard prices
a request, it resolves the price version that was effective at the request time
by selecting the version whose effective window contains that time. A new price
version does not modify an old one; it supersedes it from its effective date
forward. This is what makes the guard able to answer, months later, exactly which
price applied to a request and why the amount is what it is.

## The cost tables

The guard stores its state in sixteen tables. The vendor and pricing tables are
`apiVendors`, `vendorPriceVersions`, and `connectorSubscriptions`. The usage and
cost tables are `apiUsageRecords` and `apiCostEvents`. The control tables are
`rateLimitWindows`, `quotaAllocations`, `usageBudgets`, and `spendingLimits`.
The optimization tables are `costAnomalies`, `optimizationDecisions`,
`cacheUsageRecords`, `batchUsageRecords`, and `retryWasteRecords`. The emergency
and export tables are `vendorShutdownControls` and `costExportReceipts`.

Every table has the indexes its read paths require. Vendor and price lookups are
indexed by vendor and effective date. Usage and cost reads are indexed by
connector, system, tenant, and customer reference against the billing period, so
a period report never scans the whole table. Cross-hub reads are indexed by
correlation identifier, causation identifier, idempotency key, cost-event
identifier, request identifier, and pricing-version identifier. Control reads
are indexed by budget status, anomaly status, and shutdown status. No read path
uses an unbounded `.collect()`; every read is bounded by an index and a limit.

## The cost-event ledger

The `apiCostEvents` table is the ledger. A cost event carries the source hub,
the event version, the schema version, the vendor, the connector, the FSTS
system, the service, the tenant and customer scope where authorized, the
correlation and causation identifiers, the idempotency key, the request
identifier, the quantity and unit type, the amount in minor units, the currency,
the pricing-version identifier, the cost status, the calculation version, the
effective date, the audit reference, and the billing period.

The ledger is authoritative and deduplicated. When a cost event is recorded, the
guard first checks whether the cost-event identifier already exists; if it does,
the record is a duplicate and is rejected without a second charge. It then
checks the idempotency key: if the key exists and maps to the same cost-event
identifier, the record is a duplicate and is rejected; if the key exists and
maps to a different cost-event identifier, the record is an idempotency conflict
and is rejected. This is what guarantees that the same external charge is never
counted twice, even when a caller retries a request or a message is delivered
more than once.

## Normalized cost events

The guard emits eleven normalized cost events, each defined as a strict,
versioned contract with a sanitized fixture. The events are
`apiHub.apiUsageRecorded`, `apiHub.apiCostRecorded`, `apiHub.retryWasteRecorded`,
`apiHub.cacheSavingsRecorded`, `apiHub.batchSavingsRecorded`,
`apiHub.quotaThresholdReached`, `apiHub.budgetThresholdReached`,
`apiHub.costAnomalyDetected`, `apiHub.connectorSpendBlocked`,
`apiHub.vendorShutdownActivated`, and `apiHub.costExported`. Each event
identifies the authoritative source hub, the event and schema version, the
vendor, the connector, the FSTS system, the tenant and customer scope where
authorized, the correlation and causation identifiers, the idempotency key, the
usage quantity and unit, the exact monetary amount and currency, the vendor
price version, the estimated or finalized status, the event timestamp, and the
audit reference. The contracts are strict objects, so an event that carries an
unknown field — including a field that would claim to be profit or margin — is
rejected at the boundary.

## The AI Hub handoff contract

The AI Hub handoff contract is a versioned reference contract that lets the AI
Hub associate an API Hub cost event with an AI execution identifier, an agent
identifier, a workflow identifier, a tool invocation identifier, a correlation
identifier, and the API Hub cost-event identifier. The contract references the
authoritative API Hub cost event and carries no monetary field of its own,
because the AI Hub must not emit a second authoritative vendor charge. The
contract also carries no prompt, no model reasoning, no raw retrieval content,
and no AI conversation content, because the API Hub must not require access to
any of those. The AI Hub associates; the API Hub owns the charge.

## The REGIVANTA handoff contract

The REGIVANTA handoff contract is a versioned normalized cost-export contract
that carries only the information REGIVANTA requires. The API Hub supplies the
measured API and vendor usage and cost. REGIVANTA owns the allocation rules, the
margin calculations, the company-wide budgets, the profitability, and the
executive reporting. The export contract carries no field that claims to be net
profit, gross margin, contribution margin, monthly recurring revenue, annual
recurring revenue, or company-wide operating cost, because those are REGIVANTA's
to compute, not the API Hub's to assert.

## Optimization controls

The guard provides request deduplication, idempotency, safe response caching,
batching, retry ceilings, exponential backoff, circuit breakers, webhook
consolidation, request coalescing, approved vendor and provider selection where
contracts permit, quota-aware routing, payload-size controls, unused-connector
detection, budget warnings, throttling, approval requirements, hard blocking,
and emergency vendor shutdown. Each optimization is recorded as an optimization
decision with its kind, its rationale, and its measured effect, so the guard can
show what it saved and why.

Cost optimization never bypasses tenant isolation, authorization, data
classification, legal retention, safety controls, emergency-event handling,
contract compatibility, or audit requirements. A cache is used only when the
contract explicitly allows caching, only when the cache is tenant-scoped, only
when it is encrypted where the classification requires it, and only under an
approved retention policy. A protected or regulated response is never cached
unless the contract explicitly allows it and the cache is tenant-scoped; the
guard denies a cache record for a protected or regulated response that is not
tenant-scoped.

## Controls and thresholds

The guard enforces rate-limit windows, quota allocations, usage budgets, and
spending limits. A rate-limit window tracks consumption against a limit for a
window. A quota allocation tracks a tenant's or customer's consumption against
an allocated quantity. A usage budget tracks spend against a budgeted amount and
raises a warning at a configured threshold. A spending limit tracks spend
against a limit and takes one of three actions: warn, which records the breach
and allows the request; throttle, which records the breach and refuses the
request with a throttled status; or block, which records the breach and refuses
the request with a blocked status. Every warning, throttle, block, approval, and
shutdown writes an audit event, so the control history is complete.

## Emergency vendor shutdown

The emergency vendor shutdown control stops all external usage of a vendor
immediately. When a shutdown is active for a vendor, the guard refuses any
request that would incur cost with that vendor, regardless of budget or quota
headroom. The shutdown is recorded with its scope, its reason, its authorizer,
and its time, and it is released only after the reason is resolved. The shutdown
is the cost-side counterpart of the connector kill switch: the kill switch stops
outbound delivery, and the vendor shutdown stops outbound spend.

## Phase 0 limits

Phase 0 establishes the schemas, the contracts, the indexes, the validated
types, the deterministic cost-calculation primitives, the policy boundaries, the
sanitized fixtures, the tests, and this documentation. Phase 0 does not connect
real vendor accounts, does not import production invoices, does not activate
production billing, and does not send live cost events to the AI Hub or to
REGIVANTA. No production vendor appears in any Phase 0 fixture. The guard is
fully exercisable against synthetic data, and the deterministic tests prove the
required behaviors without any external service.
