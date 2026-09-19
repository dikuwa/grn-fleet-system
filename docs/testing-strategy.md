# Testing Strategy

The GRN Fleet test suite is intentionally split by risk and runtime. The goal is to keep release confidence high without turning every pull request into a full-system manual-style regression.

## Tier 1 — release gate

Normal CI on `master` and pull requests runs:

- formatting/lint debt reporting
- TypeScript typecheck
- unit tests
- production build
- integration tests against disposable PostgreSQL and S3-compatible storage
- the bounded Chromium production-closure matrix

The production-closure matrix currently references **34 E2E spec files** and executes **123 browser checks** serially. It covers the highest-risk workflows: tenant isolation, role routing, request/approval lifecycle, programme workflow, driver/offline operations, inspection permissions, document/PDF behavior, audit provenance, authentication isolation, settings, maintenance, and other production-critical closure paths.

Do not add a browser suite to this tier merely because it exists. Promote only deterministic tests that protect a unique high-risk contract.

## Tier 2 — extended browser coverage

`.github/workflows/extended-e2e.yml` is intentionally separate from release CI.

It runs:

- manually through `workflow_dispatch`
- nightly
- on pull requests only when the extended workflow or one of its selected E2E files changes

The extended lane contains 12 skip-free suites / approximately 46 checks:

- calendar and badge behavior
- dark-mode persistence
- driver acknowledgement queue isolation
- fuel-efficiency reporting
- licence-expiry reporting
- manual Trip Authority numbering
- notification delivery and read-state behavior
- offline conflict resolution
- offline drafts
- public-site behavior
- repaired role-isolation workflow
- complete multi-role request-to-trip lifecycle

Failures here should be investigated, but the lane must not become a hidden second release gate.

## Tier 3 — legacy / quarantine

The remaining E2E suites fall into two categories:

### Duplicate broad smoke

Keep outside automated release blocking when equivalent or stronger coverage already exists in Tier 1:

- `active-trips-smoke.spec.ts`
- `mobile-responsive.spec.ts`
- `regional-trip-workflow.spec.ts`
- `seed-logins.spec.ts`
- `settings-branding-ui.spec.ts`
- `ui-smoke.spec.ts`

These can still be useful for exploratory/manual runs, but should not duplicate the permanent gate. The superseded `full-trip-workflow.spec.ts` and `trip-return-due-lifecycle.spec.ts` suites have been retired.

### Conditional / skip-heavy debt

Rewrite or retire before promotion:

- `photo-upload-workflow.spec.ts`
- `physical-trip-authority-reservation.spec.ts`
- `public-request-lifecycle.spec.ts`
- `route-calculation.spec.ts`
- `route-flow.spec.ts`

A skipped test does not count as release evidence. Prefer deterministic fixtures and explicit local substitutes for external services.

## Promotion rule

Promote an E2E test into the production-closure matrix only when all are true:

1. It protects a unique production-critical contract.
2. The behavior cannot be covered more cheaply at unit/integration level.
3. It is deterministic in disposable CI.
4. It contains no environment-dependent skip path for its core assertion.
5. It has failed at least once for a meaningful regression or closes an identified audit gap.
6. Its runtime cost is justified by the risk it protects.

## Failure triage

When CI fails, classify before changing production code:

1. **Product defect** — current behavior violates the intended contract. Fix product code and add/retain regression coverage.
2. **Stale test contract** — product behavior is intentionally newer than the test. Update the test only.
3. **Fixture/environment defect** — CI setup does not satisfy a valid production requirement. Fix the fixture/environment, not the requirement.
4. **External/flaky dependency** — move out of the release gate or replace with a deterministic seam.

Never weaken authorization, lifecycle, validation, or readiness rules merely to make E2E pass.

## Practical rule for future apps

Keep the pyramid wide at the bottom:

- most behavior in unit tests
- cross-module/database contracts in integration tests
- only the smallest critical user journeys in blocking E2E
- broad visual, compatibility, and secondary workflows in scheduled/manual extended suites

If the blocking E2E suite keeps growing, require a risk justification for every new test and remove weaker duplicates when a stronger closure test replaces them.
