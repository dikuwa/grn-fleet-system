# Platform Role, Subscription, and Routing Controls Progress

## Status: Phase 4 - In Progress

## Quick Reference

- Research: `docs/platform-role-subscription-routing-controls/RESEARCH.md`
- Implementation: `docs/platform-role-subscription-routing-controls/IMPLEMENTATION.md`

## Phase Progress

### Phase 1: Authority Boundaries

**Status:** Completed

#### Tasks Completed

- Platform roles are excluded from tenant role reads.
- Reserved platform names and platform-role mutations are rejected server-side.
- Platform user management requires both the super-admin permission and exact super-admin role.
- Final-super-admin continuity protection remains in place.

### Phase 2: Subscription Decision Context

**Status:** Completed

#### Tasks Completed

- Added compact package comparison cards with interval-aware pricing.
- Added descriptions, vehicle/user/driver limits, trials, and feature-group counts.
- Verified upgrade/downgrade selection enables Apply without submitting a live change.

### Phase 3: Version-safe Routing Reordering

**Status:** Completed

#### Tasks Completed

- Added accessible move-up/move-down controls and unsaved-change state.
- Added quoted red typed confirmation for publishing.
- All routing changes create a new active definition version.
- Existing instances remain linked to the previous immutable definition.
- Driver Acknowledgement is protected as the terminal step.

### Phase 4: Verification and Deployment

**Status:** In Progress — deployment pending

## Architectural Decisions

- Platform role definitions remain GovFleet-managed; platform role assignments stay in Platform Users.
- Workflow order changes publish a new definition version instead of mutating an active definition.
- Driver Acknowledgement remains terminal.
- Assignment and scope changes also publish a new version so in-progress requests are fully isolated.

## Session Log

### 2026-08-11

- Traced current role, subscription, and workflow implementations.
- Confirmed existing schema supports immutable workflow version publication without migration.
- Implemented all three governance controls.
- Passed 375 automated tests, TypeScript, targeted lint, and production build.
- Browser-verified 12 tenant roles with no platform roles, typed routing confirmation, package comparison and downgrade selection.
- Verified crafted tenant mutation of a platform role is rejected with HTTP 403.
- Verified invalid non-terminal Driver Acknowledgement order is rejected with HTTP 422.
- Full-repository lint remains blocked by pre-existing errors outside this change; every changed source file passes targeted lint.

## Files Changed

- `src/lib/workspaces.ts`
- `src/lib/workflow-routing.ts`
- `src/app/api/admin/roles/route.ts`
- `src/app/api/admin/workflows/route.ts`
- `src/app/api/platform/users/route.ts`
- `src/app/(dashboard)/dashboard/admin/workflows/page.tsx`
- `src/app/(dashboard)/dashboard/platform/subscriptions/page.tsx`
- `src/app/(dashboard)/dashboard/platform/users/page.tsx`
- `src/test/governance-controls.test.ts`
