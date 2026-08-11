# Platform Role, Subscription, and Routing Controls Implementation Plan

## Overview

Implement three connected governance improvements using existing application models and design components.

## Prerequisites

- Existing Platform Users management.
- Existing versioned workflow definitions.
- Existing subscription package pricing and limit fields.

## Phase Summary

1. Authority boundaries
2. Subscription decision context
3. Version-safe routing reordering
4. Verification and deployment

## Phase 1: Authority Boundaries

### Objective

Remove platform roles from tenant administration and harden platform super-administrator continuity.

### Tasks

- [x] Add shared platform-role classification.
- [x] Filter tenant role reads and reject platform-role creation/update.
- [x] Verify Platform Users remains the only assignment surface.
- [x] Prevent non-super platform identities from managing platform users.

### Success Criteria

Tenant role responses never expose platform roles and direct writes are rejected.

## Phase 2: Subscription Decision Context

### Objective

Make package selection understandable inside assignment and upgrade/downgrade dialogs.

### Tasks

- [x] Include description and major limits in package option data.
- [x] Add interval-aware package comparison UI.
- [x] Preserve billing interval availability and change validation.

### Success Criteria

An administrator can see price, trial, capacity and a concise package description without leaving the dialog.

## Phase 3: Version-safe Routing Reordering

### Objective

Allow approval steps to be rearranged without changing in-progress requests.

### Tasks

- [x] Add accessible ordering controls and dirty-state tracking.
- [x] Require typed confirmation for order changes.
- [x] Publish changed order as a new active workflow version.
- [x] Keep Driver Acknowledgement terminal and audit before/after order.

### Success Criteria

New requests use the new route; existing instances retain their original definition and step meaning.

## Phase 4: Verification and Deployment

### Tasks

- [x] Add regression tests.
- [x] Run targeted lint, types, tests and production build.
- [x] Verify as tenant and platform users.
- [ ] Deploy and verify the production alias.

## Post-Implementation

- [x] Record changed files and evidence.
- [x] Confirm audit payload and version behavior through tests and rejected live-boundary checks.
