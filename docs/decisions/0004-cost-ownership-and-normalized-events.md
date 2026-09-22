# ADR 0004: Cost ownership and normalized cost events

- Status: Accepted
- Date: 2026-09-22
- Owner: Full Stack Tech & Solutions LLC
- Supersedes: none
- Related: ADR 0001 (API Hub as an integration control plane), ADR 0002 (runtime architecture)

## Context

Three FSTS platforms measure cost: the ARMA API Hub, the FSTS AI Hub, and
REGIVANTA Cost Guard. Each measures a different slice. The API Hub measures the
cost of external APIs, connectors, webhooks, retries, data transfer, and
API-related storage. The AI Hub measures the cost of AI models, providers,
tokens, prompts, agents, retrieval, and AI execution. REGIVANTA measures
company and customer profitability, allocated infrastructure cost, contribution
margin, budgets, forecasts, and executive financial reporting.

The three slices touch the same money, and without a locked boundary they would
drift into duplicating each other. The API Hub could start computing margin. The
AI Hub could start re-pricing the external API calls its tools make. REGIVANTA
could start re-measuring vendor usage. Each duplication would produce a second
number for the same charge, and the two numbers would eventually disagree, and
no one would know which one was authoritative. The cost of that ambiguity is
paid in reconciliation effort, in disputes with customers, and in decisions made
on numbers that are quietly wrong.

The API Hub also needs to measure and govern external usage in a way that is
exact. Money must not be stored as a floating-point number, because floating
point cannot represent every cent exactly and the errors compound across
millions of requests. A vendor price change must not retroactively rewrite the
cost of past requests, because the past was billed at the old price. The same
external charge must not be counted twice, because a retried request or a
redelivered message would otherwise double the recorded cost.

## Decision

Cost ownership is split into three locked slices. The API Hub owns external API,
connector, webhook, retry, data-transfer, and API-storage cost, and it is the
authoritative source for the charge a vendor levies for an external request. The
AI Hub owns AI model, provider, token, prompt, agent, retrieval, and AI-execution
cost, and it is the authoritative source for the cost of an AI execution. It is
not the authoritative source for the external API call an AI tool made. REGIVANTA
owns profitability, margin, allocation, budgets, forecasts, and executive
reporting, and it is the authoritative source for business-level financial
numbers. It is not the authoritative source for the measured cost of an external
call.

The API Hub must not calculate company profitability or contribution margin, and
it must not select AI models, inspect or optimize prompts, or control AI-agent
reasoning. The AI Hub must not recreate API billing, connector quota,
webhook-cost, retry-cost, or vendor-price logic. REGIVANTA must not re-measure
external API usage or re-price a vendor call.

The integration flow is a single ordered path. The AI Hub chooses an approved AI
model or tool. The API Hub performs the governed external request. The API Hub
records the API and vendor usage and cost. The AI Hub associates that cost with
the AI execution. REGIVANTA receives the normalized profitability data that
references both.

Every cross-hub cost record carries the same shared identifiers: the correlation
identifier, the causation identifier, the idempotency key, the cost-event
identifier, the source-system identifier, the tenant or organization identifier
where applicable, the customer or account reference where authorized, the API
contract version, and the cost-event schema version. The cost-event identifier
is the anchor. The API Hub is the authoritative source for the external charge,
and the cost-event identifier names that charge. The AI Hub may reference the
cost-event identifier but must not emit a second authoritative vendor charge.
REGIVANTA aggregates referenced cost without duplicating it.

The API Hub emits eleven normalized cost events, each a strict, versioned
contract with a sanitized fixture. It provides an AI Hub handoff contract that
references an authoritative API Hub cost event and carries no monetary field and
no AI content. It provides a REGIVANTA export contract that carries measured
usage and cost and no profitability field.

Money is stored as integer minor currency units and never as a floating-point
number. Every calculated amount records the currency, quantity, unit type, unit
price, pricing source, vendor price version, effective date, calculation
version, and estimated or finalized status. Vendor price versions are immutable;
a new version supersedes an old one from its effective date forward and never
overwrites historical usage. Cost events are deduplicated on both the cost-event
identifier and the idempotency key, so the same external charge is never counted
twice.

## Alternatives considered

**A single shared cost ledger owned by one platform.** Rejected. A single ledger
would have to model external API cost, AI execution cost, and business
profitability in one schema, which would force one platform to own concerns it
does not understand. The API Hub does not understand model routing; REGIVANTA
does not understand connector retries. A shared ledger would also become a
single point of contention and a single point of failure for three platforms
with different lifecycles.

**Letting each platform measure everything it touches.** Rejected. This is the
duplication the decision exists to prevent. If the AI Hub re-prices the external
calls its tools make, and the API Hub also prices them, the two numbers will
disagree and neither will be authoritative. The same applies to REGIVANTA
re-measuring vendor usage.

**Storing money as a floating-point number.** Rejected. Floating point cannot
represent every cent exactly, and the error compounds across requests. Integer
minor units are exact and are the only representation the guard accepts.

**Overwriting historical usage when a vendor price changes.** Rejected. The past
was billed at the old price. Overwriting it would make the ledger disagree with
the vendor's invoice and would destroy the ability to explain a past charge.

**Counting a charge once per record without deduplication.** Rejected. A retried
request or a redelivered message would double the recorded cost. Deduplication
on the cost-event identifier and the idempotency key is required.

**Enforcing the boundary by convention only.** Rejected. A convention that
relies on good behavior will be violated by the first well-meaning change that
does not know the convention exists. The boundary is enforced by strict
contracts that reject unknown fields, by tables that have no column for margin
or profit, and by deterministic tests that assert the prohibited behaviors are
rejected.

## Consequences

The three platforms can each be the system of record for their own slice without
duplicating each other. The shared identifiers are the seam that lets the slices
be joined without being merged, so REGIVANTA can aggregate referenced cost
without double-counting. The exact monetary arithmetic means the ledger agrees
with the vendor's invoice to the cent. The immutable price versions mean a past
charge can always be explained. The deduplication means a retried request never
doubles the recorded cost.

The cost is that the boundary must be maintained. A new cost field must be
placed in the correct slice, and a new cross-hub record must carry the shared
identifiers. The strict contracts and the tests make a violation fail loudly
rather than silently, which is the intended tradeoff: a boundary violation
should be a build failure, not a reconciliation surprise.

## Follow-up decisions

The following are deferred and must be recorded as ADRs before production: the
production vendor-account connection model, the production invoice-import and
finalization process, the production cost-export transport to REGIVANTA, the
production AI Hub association transport, and the production anomaly-detection
thresholds. Each must document its tradeoffs, its idempotency guarantees, and
its audit capabilities. None of them may weaken the cost-ownership boundary
recorded here.
