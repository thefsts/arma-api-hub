# ARMA API HUB — Phase 0 Todo

## 1. Repository verification
- [x] Clone repo, confirm origin/main SHA
- [x] Read every existing file
- [x] Confirm public visibility
- [x] Confirm LICENSE intact
- [x] Inspect branches, PRs, issues, workflows
- [x] Record current architecture
- [x] Report differences from PM baseline (none)

## 2. Reuse assessment
- [x] Enumerate FSTS repos; identify available vs unavailable
- [x] Inspect arma-partner-api-sandbox
- [x] Inspect fsts-ai-hub
- [x] Write docs/planning/REUSE-ASSESSMENT.md

## 3. Branch + scaffold
- [x] Create branch foundation/platform-runtime
- [x] Scaffold monorepo directory structure
- [x] Root package.json, pnpm-workspace, turbo.json, tsconfig
- [x] Tooling: eslint, prettier, vitest, secret scan, dep check
- [x] .env.example, .nvmrc, .node-version, engines

## 4. Contracts
- [x] Shared envelope contracts (packages/contracts)
- [x] Registry contracts
- [x] Initial contract catalog (15 schemas + fixtures)

## 5. Tests
- [x] Deterministic tests for all 16 required scenarios (51 tests passing)

## 6. Docs
- [x] PHASE-0-PLAN.md
- [x] REUSE-ASSESSMENT.md
- [x] RUNTIME-ARCHITECTURE.md
- [x] ADR runtime
- [x] THREAT-MODEL.md
- [x] DATA-CLASSIFICATION.md
- [x] SERVICE-ONBOARDING.md
- [x] CREDENTIAL-REVOCATION.md
- [x] CONNECTOR-KILL-SWITCH.md

## 7. CI + validation
- [x] CI workflow (PR + main)
- [x] Run lint, typecheck, test, build, validate locally

## 8. Push + PR
- [ ] Commit checkpoints
- [ ] Push branch
- [ ] Open PR (unmerged)
- [ ] Final report
