# Selective Reset Builder Progress

## Status: Phase 4 - In Progress

## Quick Reference

- Research: `docs/selective-reset-builder/RESEARCH.md`
- Implementation: `docs/selective-reset-builder/IMPLEMENTATION.md`

## Phase Progress

### Phase 1: Catalog and Plan Contract

**Status:** Complete

#### Tasks Completed

- Architecture and safety invariants documented.
- Versioned category catalog, dependency resolver, cutoff contract and compatibility scope mapping implemented.

#### Decisions Made

- Business-domain catalog instead of raw table selection.
- Backward-compatible metadata specification instead of replacing the current scope workflow.
- One protected Tenant Owner and all commercial/audit/recovery records remain immutable.

#### Blockers

- None.

### Phase 2: Production Workflow Integration

**Status:** Complete

- Dry run, fingerprint, approval, recovery archive v2, restore and atomic execution support selected categories.
- Live-schema foreign-key ordering is applied automatically to selected tables.
- Platform-wide selection creates an independently reviewed request per production tenant.

### Phase 3: Theme-aware Reset Builder UI

**Status:** Complete

- Tenant Administrator and Platform Administrator builders use shared theme-aware components.
- Presets, dependencies, cutoff, protected-data badges and red quoted confirmations are visible.

### Phase 4: Verification and Delivery

**Status:** In Progress

- TypeScript, lint and focused unit tests pass.
- Every preset built successfully against the configured production schema without mutation.
- Clean slate passed foreign-key ordering and row-for-row backup export verification (5,801 rows in the current KERC dataset after protecting both tenant and platform administrator memberships).

## Session Log

### 2026-08-11

- Audited the current operational engine, backup format, request approval, platform reset, schemas, and dependency graph.
- Selected a catalog/specification architecture that extends existing behavior.
- Implemented the catalog, planner, atomic executor, v2 recovery archive, restore support and shared UI.
- Corrected cutoff root scoping so only selected historical request IDs are deleted.
- Verified all domain presets against the live schema using read-only plans.

## Files Changed

- See the branch diff for the catalog, planner, workflow APIs, UI, tests and verification script.

## Architectural Decisions

- The operational preset remains the default and is normalized as a versioned specification.
- Cutoffs apply to operational roots and include their full dependent trees.
- Platform-wide cleanup runs per tenant.

## Lessons Learned

- Existing enum scopes and ordered operational plan already provide most workflow primitives; the missing abstraction is the business-domain catalog.
