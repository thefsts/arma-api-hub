# ADR 0001: API Hub as an integration control plane

- Status: Accepted
- Date: 2026-09-21
- Owner: Full Stack Tech & Solutions LLC

## Context

FSTS systems require reliable, observable, and governed interoperability without merging product databases or centralizing unrelated business logic and sensitive records.

## Decision

ARMA API Hub will operate as a standalone shared integration control plane. It will own service identity, contract governance, message delivery controls, receipts, retries, health, and integration auditability.

Connected products retain their databases, tenant authorization, business rules, customer data, and product-specific audit records. Browser and mobile clients will not hold privileged API Hub credentials.

Production connectors require a separate architecture decision, threat analysis, approved contract, named owners, data classification, tenant model, kill switch, test evidence, and rollback plan.

## Consequences

The platform gains consistent service-to-service controls and monitoring. Integrations require explicit onboarding and versioned contracts. Product teams must maintain local authorization and cannot use API Hub as a shortcut around product boundaries.
