# Cost Ownership Boundaries — ARMA API Hub

## Purpose

Three FSTS platforms measure and act on cost, and each owns a different slice of
it. The ARMA API Hub owns the cost of external APIs, connectors, webhooks, and
vendor usage. The FSTS AI Hub owns the cost of AI models, providers, tokens,
prompts, agents, retrieval, and AI execution. REGIVANTA Cost Guard owns
company-level and customer-level profitability, allocated infrastructure cost,
contribution margin, budgets, forecasts, and executive financial reporting.

These three slices touch the same money but they are not the same money, and
they must never be conflated. This document locks the boundary between them so
that no platform duplicates another platform's accounting, no platform
recalculates a charge another platform already owns, and no platform silently
becomes the system of record for a number it does not own. The boundary is
enforced in code by the normalized cost contracts, by the cost tables, and by
the deterministic tests that assert the prohibited behaviors are rejected.

## The locked boundary

The ARMA API Hub owns external APIs, connectors, webhooks, external requests,
retries and redeliveries, vendor rate limits and quotas, connector
subscriptions, data transfer, API-related storage, API and vendor usage
measurement, API and vendor cost optimization, connector spending limits, and
emergency vendor shutdown controls. The API Hub is the authoritative source for
the charge a vendor levies for an external API call, a connector operation, a
webhook delivery, a retry, a byte transferred, or a byte stored on behalf of an
external integration.

The FSTS AI Hub owns AI models and providers, model selection and routing,
tokens, prompts, agents, retrieval and embeddings, AI tools and workflows, AI
execution cost, AI provider optimization, and model fallback and quality or
cost decisions. The AI Hub is the authoritative source for the cost of an AI
execution. It is not the authoritative source for the cost of the external API
call that an AI tool made; that charge belongs to the API Hub.

REGIVANTA Cost Guard owns company and customer profitability, allocated
infrastructure cost, contribution margin, budgets, forecasts at the business
level, executive financial reporting, and cross-product cost aggregation.
REGIVANTA is the authoritative source for profitability and margin. It is not
the authoritative source for the measured cost of an external API call; it
aggregates the cost the API Hub measured and the cost the AI Hub measured, and
it applies its own allocation rules on top.

## What each platform must not do

The API Hub must not calculate company profitability or contribution margin. It
must not select AI models, inspect or optimize prompts, or control AI-agent
reasoning. It must not emit a field that claims to be net profit, gross margin,
contribution margin, monthly recurring revenue, annual recurring revenue, or
company-wide operating cost. It measures and reports the cost of external
usage; it does not decide what that cost means for the business.

The AI Hub must not recreate API billing, connector quota, webhook-cost,
retry-cost, or vendor-price logic. When an AI tool makes an external request
through the API Hub, the AI Hub references the API Hub's cost event; it does not
emit a second authoritative vendor charge for the same call. The AI Hub may
associate an API Hub cost event with an AI execution, an agent, a workflow, or a
tool invocation, but the monetary amount on that association is a reference to
the API Hub's authoritative event, not a recalculation.

REGIVANTA must not re-measure external API usage or re-price a vendor call. It
receives normalized cost records from the API Hub and the AI Hub, and it owns
the allocation, margin, budget, and reporting logic that turns those records
into business-level numbers. It must not emit a second authoritative vendor
charge for a call the API Hub already priced.

## The required integration flow

The flow that keeps the boundary intact is a single ordered path. The AI Hub
chooses an approved AI model or tool. The API Hub performs the governed external
request on behalf of that tool. The API Hub records the API and vendor usage and
the resulting cost. The AI Hub associates that cost with the AI execution that
caused it. REGIVANTA receives the normalized profitability data that references
both. At no point does a platform downstream of the API Hub re-price the
external call, and at no point does a platform upstream of REGIVANTA claim to
know the company's margin.

## Shared identifiers on every cross-hub cost record

Every cross-hub cost record carries the same shared identifiers so that the same
external charge can be recognized as the same charge by every platform that
touches it. The shared identifiers are the correlation identifier, the causation
identifier, the idempotency key, the cost-event identifier, the source-system
identifier, the tenant or organization identifier where applicable, the
customer or account reference where authorized, the API contract version, and
the cost-event schema version.

The cost-event identifier is the anchor. The API Hub is the authoritative source
for the external API or connector charge, and the cost-event identifier names
that charge. The AI Hub may reference the cost-event identifier but must not
emit a second authoritative vendor charge for the same call. REGIVANTA
aggregates referenced cost without duplicating it: when two records carry the
same cost-event identifier, REGIVANTA counts the charge once.

## Why the boundary is enforced in code

The boundary is not a convention that relies on good behavior. It is enforced by
the normalized cost contracts, which are strict objects that reject unknown
fields, so a record that tries to carry a profitability field is rejected at the
schema boundary. It is enforced by the cost tables, which store measured usage
and measured cost and have no column for margin or profit. It is enforced by the
deterministic tests, which assert that an AI Hub reference carries no monetary
field, that a REGIVANTA export carries no profitability field, that the API Hub
rejects an attempt to select an AI model, and that the AI Hub contract rejects
an attempt to recreate API billing. A future change that weakens the boundary
must fail one of these tests, which is the point.

## Relationship to the platform boundary

This cost boundary is a specialization of the platform boundary recorded in ADR
0001 and in the platform boundaries document. The API Hub routes and records; it
does not make product decisions. The cost boundary adds that the API Hub
measures and records external cost; it does not decide what that cost means for
the business, and it does not reach into the AI Hub's model governance or into
REGIVANTA's financial reporting. Each platform remains the system of record for
its own slice, and the shared identifiers are the seam that lets the slices be
joined without being merged.
