# Component Plan

## 1. Registry policy

Use approved project components first, then verified VibeKit/JB components, then shadcn primitives, then custom implementation. Registry installation is not permission to overwrite existing files. Every install must be inspected and merged.

The coder must verify current install commands from the repository/registry before use.

## 2. JB/VibeKit feature units selected

| Need | Candidate | Use |
|---|---|---|
| Authentication UI | JB Better Auth UI | Install as a base, remove public sign-up/OAuth/mandatory email verification, adapt to tenant access |
| Advanced tables | Data Table | Requests, staff, fleet, fuel, reports and audit |
| Searchable selections | Searchable Select | Staff, drivers, offices, vehicles and locations |
| Request/import workflows | Multi-Step Form | Transport request and staff/vehicle imports |
| Notifications | Notification Center | Bell dropdown and notification centre |
| Private uploads | File Storage UI | Documents, inspection photos and receipts; adapt to private R2 |
| Official documents | Printable Templates | Structural base only; build government-specific React PDF templates |
| Analytics | Charts & Dashboard Grid | Use selectively for reports |
| Organisation UI | Organization & Team UI | Reuse role/member patterns, replace invite/public onboarding behaviour |
| Form primitives | VibeKit Form fallback | Install in Phase 1 if current shadcn form package is absent |

## 3. VibeKit primitives selected

Verify each item before installation:

- `use-current-user`
- `require-auth`
- `require-role` (extend to capability checks)
- `role-gate`
- `parse-form-data`
- `use-table-state`
- `stat-card`
- `empty-state`
- `confirm-dialog`
- `loading-button`
- `copy-button`
- `use-media-query`
- `use-debounce`
- `page-header`
- `breadcrumbs`
- `formatters`
- `env-validator`
- `rate-limit`
- `field`
- `form-combobox`
- `form-date-picker`
- `use-unsaved-changes`
- `api-client`
- `query-keys`
- `use-paginated-query`
- `column-header`
- `data-table-toolbar`
- `bulk-actions-bar`
- `send-email`

## 4. Custom components required

- `TenantSwitcher`
- `ActingRoleIndicator`
- `WorkflowTimeline`
- `CurrentActionPanel`
- `ApprovalActionDialog`
- `EmergencyOverrideDialog`
- `RouteDistanceCard`
- `VehicleRecommendationPanel`
- `VehicleAvailabilityCalendar`
- `VehicleAllocationDrawer`
- `InspectionChecklist`
- `InspectionPhotoGrid`
- `OdometerInput`
- `FuelLevelSelector`
- `DriverLicenceStatus`
- `DailyLogEntryCard`
- `OfflineSyncBanner`
- `SyncConflictDialog`
- `FuelReceiptForm`
- `TripClosureChecklist`
- `DocumentPreview`
- `SecureShareDialog`
- `AuditEventTimeline`
- `ImportMappingWizard`
- `ImportValidationTable`
- `PermissionMatrix`
- `OfficeTree`

## 5. Generated file merge rules

Before installing a registry component:

1. Commit current work.
2. Inspect registry manifest and dependencies.
3. Run install on a temporary branch if it touches auth, layout or schema.
4. Diff all generated files.
5. Preserve the approved fonts, tokens, route groups, providers and database layer.
6. Remove unused pages and dependencies.
7. Run type-check and build.
8. Document the component and modifications in `CHANGELOG.md`.

## 6. Components deliberately rejected

- Stripe and billing components
- Shopping cart/ecommerce components
- Rich-text editor unless later justified for notes
- Kanban board
- Generic pricing/subscription UI
- Blurred orb and custom cursor
- Dark-mode switcher
- Public organisation invites

## 7. Accessibility requirements

All imported components must be verified for keyboard use, focus management, labels, screen-reader text, contrast and touch targets. Registry origin does not exempt a component from testing.
