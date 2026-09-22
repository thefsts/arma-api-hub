# ARMA API HUB — Convex + Cost Guard Todo

## A. Convex setup
- [x] Add convex + convex-test dependencies
- [x] convex.json project config (existing project, no new project)
- [x] convex/tsconfig.json
- [x] .env.example placeholders (no real values)
- [x] Verify .env.local gitignored
- [x] Link repo to arma-api-hub / merry-mockingbird-631

## B. Core schema (20 tables)
- [x] convex/schema.ts with 20 tables
- [x] Indexes for every expected read path
- [x] Shared validators

## C. Core functions
- [x] lib helpers (authz, redaction, ids, errors, validators)
- [x] Public queries/mutations (minimal, authorization-aware)
- [x] Internal functions (lifecycle, retry, receipt, audit, credential)

## D. Cost & Usage Guard — schema
- [x] 16 cost tables + indexes (vendor/effective date, connector/system/tenant/customer + period, correlation, causation, idempotency, cost-event, request, pricing-version, budget status, anomaly status, shutdown status)

## E. Cost & Usage Guard — functions
- [x] vendors, price versions, subscriptions
- [x] usage records, cost events (authoritative, dedup)
- [x] rate limit windows, quotas, budgets, spending limits
- [x] anomalies, optimization decisions, cache/batch/retry waste
- [x] vendor shutdown controls, cost export receipts

## F. Cost contracts + fixtures
- [x] 11 normalized cost event contracts
- [x] AI Hub handoff contract
- [x] REGIVANTA export contract
- [x] sanitized fixtures

## G. Cost tests
- [x] 20 deterministic cost scenarios

## H. Docs
- [x] COST-OWNERSHIP-BOUNDARIES.md
- [x] API-COST-AND-USAGE-GUARD.md
- [x] ADR 0004
- [x] VENDOR-SPEND-LIMIT.md
- [x] EMERGENCY-VENDOR-SHUTDOWN.md
- [x] Update threat model, data classification, runtime architecture, phase 0 plan, PR body

## I. Verification
- [x] Convex codegen
- [x] TypeScript typecheck
- [x] Schema validation
- [x] Backend unit tests
- [x] Contract tests
- [x] npx convex dev --once

## J. Commit + report
- [x] Commit checkpoints
- [x] Push branch (PR #1 stays open/unmerged)
- [x] Final correction report
