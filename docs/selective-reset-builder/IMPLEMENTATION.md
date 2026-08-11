# Selective Reset Builder Implementation Plan

## Overview

Build a reusable, versioned reset catalog on top of the current production reset workflow. Preserve operational reset compatibility while adding selected domains, cutoff cleanup, clean-slate presets, and platform batch targeting.

## Prerequisites

- Existing operational plan, preview, approval, backup, confirmation, audit, and integrity paths.
- Durable R2/S3 backup configuration remains mandatory.

## Phase Summary

1. Catalog and specification foundation.
2. Selective planning, recovery points, and execution.
3. Tenant and platform user experience.
4. Automated and real-user production verification.

---

## Phase 1: Catalog and Plan Contract

### Objective

Introduce the versioned reset specification, presets, dependency resolver, protected invariants, and operational cutoff support.

### Tasks

- [ ] Create the category catalog and pure resolver.
- [ ] Preserve legacy operational requests through normalization.
- [ ] Extend operational entity collection with an optional cutoff.
- [ ] Add unit tests for presets, dependencies, and invalid specs.

### Success Criteria

Existing operational tests pass and resolved plans are deterministic.

### Files Likely Affected

- `src/lib/reset-catalog.ts`
- `src/lib/data-reset/plan.ts`
- reset tests

---

## Phase 2: Production Workflow Integration

### Objective

Carry the reset specification through request creation, preview, recovery point, fingerprint, execution, and audit.

### Tasks

- [ ] Store normalized specifications in request metadata.
- [ ] Add selected-domain preview counts and dependency information.
- [ ] Export every planned row into a versioned recovery archive.
- [ ] Execute dependency-safe domain plans and preserve owner/commercial/audit records.
- [ ] Add post-reset integrity checks and exact execution confirmation.

### Success Criteria

No non-operational request can execute without approval, an unchanged preview, a verified recovery point, and typed confirmation.

---

## Phase 3: Theme-aware Reset Builder UI

### Objective

Expose presets and categories consistently to Tenant and Platform Administrators.

### Tasks

- [ ] Add preset selection and category cards to the tenant request flow.
- [ ] Add target/preset/category controls to Platform Reset management.
- [ ] Display auto-included dependencies, cutoff, protected data, and dashboard impact.
- [ ] Keep existing operational actions and request history compatible.

### Success Criteria

Keyboard-accessible, responsive, light/dark theme UI with no table-level terminology required from users.

---

## Phase 4: Verification and Delivery

### Objective

Prove compatibility and production behavior.

### Tasks

- [ ] Typecheck, lint, unit/integration tests, and production build.
- [ ] Real-user tenant request and Platform Admin review tests.
- [ ] Deploy through PR and verify dashboard/reset results.

### Success Criteria

The legacy operational path and new reset-builder paths behave correctly in production.

## Post-Implementation

- [ ] Document catalog extension procedure.
- [ ] Validate large-tenant preview performance.
- [ ] Add future platform-native categories through the same catalog contract.

## Notes

Audit events, subscriptions, payments, backup/reset history, global auth accounts, and the final owner remain outside every selectable category.
