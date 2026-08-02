# Application-wide mobile responsiveness audit

Date: 2026-08-02

## Scope and route inventory

The audit covered all 82 authenticated page routes discovered under `src/app/(dashboard)`, their shared shell, tabs, dialogs, drawers, forms, tables, maps, uploads, and action-linked detail pages.

- Core: `/dashboard`, `/dashboard/profile`, `/dashboard/offline`, `/dashboard/sync-conflicts`, `/dashboard/notifications`, `/dashboard/notifications/deliveries`, `/dashboard/notifications/history`
- Administration: `/dashboard/admin`, `/dashboard/admin/regions`, `/dashboard/admin/roles`, `/dashboard/admin/users`, `/dashboard/admin/users/[id]`, `/dashboard/admin/workflows`, `/dashboard/settings`, `/dashboard/audit`, `/dashboard/delegations`, `/dashboard/departments`, `/dashboard/offices`, `/dashboard/organisation`, `/dashboard/programmes`, `/dashboard/share-links`
- Platform: `/dashboard/platform`, `/dashboard/platform/audit`, `/dashboard/platform/onboard`, `/dashboard/platform/tenants`, `/dashboard/platform/tenants/[id]`
- Requests and approvals: `/dashboard/requests`, `/dashboard/requests/new`, `/dashboard/requests/[id]`, `/dashboard/approvals`, `/dashboard/approvals/[id]`, `/dashboard/approvals/[id]/action`, `/dashboard/allocations`, `/dashboard/allocations/new`, `/dashboard/allocations/[id]`
- Fleet: `/dashboard/fleet`, `/dashboard/fleet/new`, `/dashboard/fleet/[id]`, `/dashboard/fleet/[id]/edit`, `/dashboard/fleet/compliance`, `/dashboard/fleet/defects`, `/dashboard/fleet/expenses`, `/dashboard/fleet/import`, `/dashboard/fleet/imports`, `/dashboard/fleet/imports/[id]`, `/dashboard/fleet/map`, `/dashboard/fleet/predictive-maintenance`, `/dashboard/expiry-alerts`
- Driver and trips: `/dashboard/drivers`, `/dashboard/drivers/[id]`, `/dashboard/driver-mobile`, `/dashboard/driver-self-service`, `/dashboard/trips`, `/dashboard/trips/active`, `/dashboard/trips/readiness`, `/dashboard/trips/closure-review`, `/dashboard/trips/[id]`, `/dashboard/trips/[id]/authority`
- Operations: `/dashboard/fuel`, `/dashboard/fuel/new`, `/dashboard/fuel/[id]`, `/dashboard/maintenance`, `/dashboard/maintenance/new`, `/dashboard/inspections`, `/dashboard/inspections/new`, `/dashboard/inspections/departure`, `/dashboard/inspections/return`, `/dashboard/inspections/templates`, `/dashboard/inspections/[id]`, `/dashboard/logs`
- People: `/dashboard/staff`, `/dashboard/staff/new`, `/dashboard/staff/[id]`, `/dashboard/staff/import`, `/dashboard/staff/imports`, `/dashboard/staff/imports/[id]`
- Documents and finance: `/dashboard/documents`, `/dashboard/documents/[id]`, `/dashboard/reimbursements`, `/dashboard/reimbursements/[id]`
- Reports: `/dashboard/reports`, `/dashboard/reports/licence-expiry`

Parameterized routes were inspected at their page/component boundary because their visible states depend on database records and role scope. The responsive changes do not alter authorization, tenant filters, route guards, APIs, workflow rules, or database schema.

## Shared implementation

- `DashboardShell`, `Sidebar`, `MobileSidebar`, `MobileBottomNav`, and `Topbar`: safe-area-aware mobile shell, fixed bottom navigation, tenant/workspace context, contained drawer, body scroll lock, Escape handling, focus trap, focus restoration, and desktop behavior retained from 768px upward.
- `ResponsivePage`, `ResponsiveFormGrid`, `ResponsiveStatsGrid`, `ResponsiveCardGrid`, `MobileActionBar`, `ResponsiveTable`, `MobileRecordCard`, `ResponsiveMapContainer`, `ResponsiveUploadZone`, and `ResponsiveStepper`: shared responsive primitives added in `src/components/ui/responsive.tsx`.
- `PageHeader` and breadcrumbs: wrapping actions, long-title containment, and compact mobile breadcrumb disclosure.
- `Button`, `Card`, `Dialog`, `Tabs`, `Select`, `StyledSelect`, employee comboboxes, toast, and PWA banner: 44px mobile touch targets, viewport-contained portals, bottom-sheet dialogs, wrapping, safe-area offsets, and mobile navigation offsets.
- Global responsive tokens: 320px minimum supported canvas, mobile page padding, touch-target and navigation-height tokens, flexible grid/flex children, long-token wrapping, reduced-motion support, and no global `overflow-x: hidden` masking.

## Route-specific implementation

- `/dashboard/requests/new`: compact five-step progress, mobile-first action bar, existing employee/passenger search retained, Google Places origin/destination selection retained with Namibia restriction, automatic debounced route calculation after two valid place selections, stale-request cancellation, calculated distance/duration state, preserved last valid value, error state, and prominent manual retry.
- `/dashboard/fleet/import`: compact four-step progress, responsive semantic upload zone, responsive field mapping/preview tables, stacked statistics, and primary-first action bar.
- `/dashboard/fleet/map`: responsive statistics and map container, ResizeObserver/orientation resize invalidation, reachable refresh action, and explicit missing-position status.
- `/dashboard/admin/users`: searchable employee account linking by name, employee number, email, office, and department; searchable role selection retained; mobile-contained invitation sheet and primary-first actions.
- `/dashboard/organisation`: wrapped tabs and mobile-left-aligned create/edit actions.

All other routes inherit shell, header, card, button, dialog, popover, select, tabs, spacing, action alignment, and safe-area fixes through shared primitives and global tokens.

## Data views, forms, and selectors

- Mobile card variants already used by staff and organisation views were retained.
- Dense operational, report, import-history, notification-delivery, request-detail, trip-detail, and fleet-detail tables retain controlled table-local horizontal scrolling where collapsing columns would remove meaning. The page canvas itself must not scroll horizontally.
- Existing one-column mobile form grids across create/edit, inspection, fuel, maintenance, allocation, staff, settings, and workflow screens are preserved; shared action groups now wrap and align left on phones.
- Searchable selectors: employee, passenger, driver, role, and invitation employee selectors. The generic `SearchableEntitySelect` exposes metadata search, disabled reasons, status text, clearing, keyboard focus, accessible combobox/listbox roles, and viewport collision containment.

## Verification

- TypeScript: pass.
- ESLint: pass with three pre-existing unused-variable warnings and no errors.
- Unit suite: 19 files, 237 tests passed.
- Production build: pass (134 static pages generated; all authenticated dynamic routes compiled).
- Responsive Playwright: 17 checks passed. `src/e2e/mobile-responsiveness.spec.ts` checks page-level overflow at 320, 360, 375, 390, 412, 430, 480, 600, 768, 820, 1024, 1280, 1440, and 1920; mobile drawer/keyboard close; sticky navigation; request/import steppers; upload input; contained searchable invitation UI; and a WCAG A/AA axe baseline with no serious or critical violations.
- Route automation unit coverage: stable place selection requirements and route calculation identity.
- Light theme: responsive matrix and five requested screenshot widths passed.
- Dark theme: the 390px dashboard capture passed without page overflow; seven existing theme tests passed. One pre-existing trips-theme test is inapplicable to the seeded tenant-administrator workspace because `/dashboard/trips` correctly returns “Access restricted”.

Screenshots were captured from the production bundle at 320, 390, 430, 768, 1024, and 1440px. The 390px capture uses dark mode; the other five use light mode. The deployment handoff links the output directory.

## Known limits

- Google route calculation depends on valid configured Maps browser/server credentials and network availability; manual distance entry and retry remain available.
- Native iPhone Safari, Android Chrome, tablet Safari, and Firefox were not available in this Chromium-only local Playwright configuration. CSS safe-area, dynamic viewport, keyboard, zoom/reflow, dark-theme, and reduced-motion behavior are implemented, but claims of physical-device execution must not be inferred from this report.
