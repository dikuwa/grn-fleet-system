# GovFleet Namibia — Implementation Roadmap

> **Last updated:** 2026-07-20
> **Working branch:** `master`
> **Database:** Neon Postgres (migrated, seeded)
> **Deployment:** https://grn-fleet-system.vercel.app

This document is the permanent execution plan for every coding session. Read it before implementing any new work.

---

## Status Legend

| Status      | Meaning                                                 |
| ----------- | ------------------------------------------------------- |
| NOT STARTED | No work has been done                                   |
| PARTIAL     | Some work done but not end-to-end functional            |
| IMPLEMENTED | Module works through its core workflow                  |
| VERIFIED    | Tested through end-to-end workflow with automated tests |
| BLOCKED     | Cannot proceed due to missing credential or dependency  |

---

## Phase 1 — Security and Data Protection

| #   | Module                           | Status   | What Exists                                                                                                                                                                                                                        | What's Missing                                                                                     | Priority |
| --- | -------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------- |
| 1.1 | Authentication                   | VERIFIED | Better Auth custom handler, session management, sign-in/sign-out, tenant membership resolution                                                                                                                                     | —                                                                                                  | CRITICAL |
| 1.2 | Route protection                 | VERIFIED | `src/proxy.ts` (Next.js 16 middleware), redirects to `/login`, `getServerSession()` on every server page                                                                                                                           | All server pages check auth before rendering                                                       | CRITICAL |
| 1.3 | Server-side session validation   | VERIFIED | `requireRequestAuth`, `requireAuth` helpers, `getServerSession()` on all server pages                                                                                                                                              | Fully implemented                                                                                  | CRITICAL |
| 1.4 | Tenant isolation                 | VERIFIED | All server pages filter by `tenantId` from session                                                                                                                                                                                 | 13 cross-tenant security tests pass                                                                | CRITICAL |
| 1.5 | Role-based access control        | VERIFIED | Full permission system (`Permissions`, `RoleDefinitions`, `auth-helpers`), 14 permission groups + 9+ additional GET route checks (trip-logs, drivers, inspections, trips, reimbursements, documents, share-links, routes, regions) | —                                                                                                  | HIGH     |
| 1.6 | API and server-action protection | VERIFIED | All 30+ API mutation routes checked (requireRequestAuth + requirePermission where mutation), all GET routes checked for view permissions                                                                                           | —                                                                                                  | HIGH     |
| 1.7 | Database constraints             | VERIFIED | Drizzle schema, proper foreign keys, migration 0004 aligned DB with schema                                                                                                                                                         | —                                                                                                  | MEDIUM   |
| 1.8 | Secure file access               | VERIFIED | R2 storage service, photo upload API, inspection photo signed URLs, tenant-scoped file keys                                                                                                                                        | ✅ Full pipeline: capture → R2 upload → inspectionPhotos table → signed URL display on detail page | MEDIUM   |
| 1.9 | Audit logging                    | VERIFIED | Audit events table, hash-chain support, WorkflowEngine logs actions, 12+ mutation routes log audit events (fuel, maintenance, regions, requests, trips/start/return/close, allocations, documents)                                 | —                                                                                                  | MEDIUM   |

---

## Phase 2 — Core Organisation Setup

| #    | Module                       | Status      | What Exists                                                                          | What's Missing                                                   | Priority |
| ---- | ---------------------------- | ----------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | -------- |
| 2.1  | Platform administration      | IMPLEMENTED | Platform dashboard, tenant list/detail, onboard API, platform admin seed             | ✅ Tenant list, detail with suspend/activate, platform dashboard | HIGH     |
| 2.2  | Multi-tenant onboarding      | IMPLEMENTED | POST `/api/platform/onboard` — creates tenant, branding, offices, departments, roles | Works end-to-end                                                 | HIGH     |
| 2.3  | Tenant administration        | IMPLEMENTED | Tenant detail page with suspend/activate dialog, status badges, PATCH API            | ✅ Full lifecycle management                                     | HIGH     |
| 2.4  | Regions                      | IMPLEMENTED | `regions` table, RESTful CRUD API, management page at `/dashboard/admin/regions`     | ✅ Full CRUD with active/inactive status                         | MEDIUM   |
| 2.5  | Offices                      | IMPLEMENTED | Office tree, `OfficeDialog` (create/edit), seed data, office filter in fleet         | ✅ Create/edit dialog works                                      | HIGH     |
| 2.6  | Departments                  | IMPLEMENTED | Seed data, department filter in staff, sidebar Departments link                      | ✅ Sidebar link added                                            | MEDIUM   |
| 2.7  | Users                        | IMPLEMENTED | Admin user list/detail, invite dialog, PATCH API for role/status updates             | ✅ User invite flow, detail page with role/status management     | HIGH     |
| 2.8  | Roles                        | VERIFIED    | 9 default roles, Role Editor UI with permission matrix, create/edit dialogs          | ✅ Full permission matrix with 14 groups                         | MEDIUM   |
| 2.9  | Permissions                  | VERIFIED    | All permission codes, groups, seed, Permission matrix in Role Editor                 | ✅ Verified with 10 integration tests                            | MEDIUM   |
| 2.10 | Initial tenant configuration | VERIFIED    | Seed creates Kavango East with full setup                                            | Works for first tenant                                           | HIGH     |

---

## Phase 3 — Core Transport Workflow

| #    | Module                 | Status      | What Exists                                                                                                                                        | What's Missing                                         | Priority |
| ---- | ---------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------- |
| 3.1  | Transport request      | IMPLEMENTED | 5-step wizard, API route, DB schema (requests, activities, passengers, drivers, routes, attachments)                                               | Request detail page with all child records             | HIGHEST  |
| 3.2  | Approval workflow      | VERIFIED    | WorkflowEngine class, regional/national definitions, action processing, separation of duty, emergency override, 10 E2E tests                       | ✅ Full approval → trip workflow tested                | HIGHEST  |
| 3.3  | Maps and routes        | VERIFIED    | RouteCalculator (Google Maps), graceful fallback, route form in wizard, route map visualization on request detail page, E2E route calculation test | —                                                      | HIGH     |
| 3.4  | Vehicle recommendation | VERIFIED    | VehicleRecommender class (deterministic scoring), category/terrain/passenger matching                                                              | ✅ Wired into allocation UI with scores/reasons        | HIGH     |
| 3.5  | Vehicle allocation     | IMPLEMENTED | Allocations list (DB-backed), allocation schema, API route, recommendation UI, DriverAssignment component                                          | ✅ Show scored recommendations, driver assign/unassign | HIGH     |
| 3.6  | Driver assignment      | IMPLEMENTED | Full `DriverAssignment` component at allocation detail, assign/unassign API, driver detail page with licence/assignment history                    | ✅ Complete driver management flow                     | HIGH     |
| 3.7  | Trip creation          | IMPLEMENTED | Trip schema, trip list, trip detail with TripActions, trip creation from allocation                                                                | ✅ Full workflow: allocation → trip                    | HIGH     |
| 3.8  | Departure inspection   | IMPLEMENTED | Inspection schema, departure inspection page at `/dashboard/inspections/new?type=departure`                                                        | ✅ 16-item checklist across 7 categories               | HIGH     |
| 3.9  | Active trip            | IMPLEMENTED | Active trips page at `/dashboard/trips/active` with real-time duration tracking, status breakdown                                                  | ✅ Full active trip tracking UI                        | HIGH     |
| 3.10 | Arrival inspection     | IMPLEMENTED | Return inspection at `/dashboard/inspections/new?type=return`, auto-closes trip on pass                                                            | ✅ 9-item return checklist                             | HIGH     |
| 3.11 | Trip completion        | IMPLEMENTED | Trip close API with closure review, closure review page at `/dashboard/trips/closure-review` with approve/reject                                   | ✅ Full closure workflow                               | HIGH     |

---

## Phase 4 — Fleet Operations

| #   | Module              | Status      | What Exists                                                                                                            | What's Missing                                   | Priority |
| --- | ------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------- |
| 4.1 | Fleet management    | VERIFIED    | Fleet list with search/filters/pagination, vehicle detail with 6 tabs, new/edit vehicle forms, vehicle import wizard   | ✅ Full fleet management                         | HIGH     |
| 4.2 | Driver management   | VERIFIED    | Driver list, detail page with licences (expiry status), assignment history, driver mobile view, self-service portal    | ✅ Complete driver management                    | MEDIUM   |
| 4.3 | Fuel management     | IMPLEMENTED | Fuel list, new entry with offline draft support, fuel API, reimbursement API                                           | Works end-to-end                                 | HIGH     |
| 4.4 | Maintenance         | IMPLEMENTED | Maintenance events in vehicle detail, maintenance list page, POST API, maintenance form (`/dashboard/maintenance/new`) | ✅ Frontend form + API + vehicle lifecycle       | MEDIUM   |
| 4.5 | Vehicle compliance  | IMPLEMENTED | Compliance API, colour-coded compliance cards at `/dashboard/fleet/compliance`                                         | ✅ Full compliance tracking with expiry timeline | MEDIUM   |
| 4.6 | Expiry alerts       | IMPLEMENTED | Expiry alerts dashboard at `/dashboard/expiry-alerts`, Inngest crons for licence/roadworthy/insurance expiry           | ✅ Driver + vehicle licence expiry alerts        | MEDIUM   |
| 4.7 | Imports and exports | IMPLEMENTED | Staff + vehicle 4-step CSV import wizards, vehicle import template, batch tracking                                     | ✅ Full import flow for both entities            | MEDIUM   |

---

## Phase 5 — Communication and Documents

| #   | Module                 | Status      | What Exists                                                                                                                               | What's Missing                                                          | Priority |
| --- | ---------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------- |
| 5.1 | Notifications (in-app) | VERIFIED    | Notifications schema, WorkflowEngine creates notifications, notifications list with filters, topbar with live unread count (30s polling)  | ✅ Live badge, Mark All Read, action links                              | HIGH     |
| 5.2 | Email                  | IMPLEMENTED | Email service (Resend), 8 React Email templates, WorkflowEngine sends email, graceful fallback, RESEND_API_KEY configured                 | ✅ Full pipeline ready                                                  | MEDIUM   |
| 5.3 | WhatsApp share         | IMPLEMENTED | Native share via Web Share API with clipboard fallback, wired into document detail page                                                   | ✅ Works on mobile devices                                              | LOW      |
| 5.4 | Secure share links     | IMPLEMENTED | Share link API (create/revoke), HMAC-SHA256 token hashing, view tracking, create-share-link dialog on document detail                     | ✅ Full share link management                                           | MEDIUM   |
| 5.5 | PDF generation         | IMPLEMENTED | Document generator with builder pattern, 4 snapshot builders, lifecycle triggers on request/trip/inspection events                        | ✅ 6 document types generated                                           | HIGH     |
| 5.6 | File uploads           | VERIFIED    | Upload API (`/api/upload`), R2 storage service, document file upload flow, inspection photo upload wired with signed URLs on detail page  | ✅ Full photo pipeline: capture → upload → inspect → signed URL display | MEDIUM   |
| 5.7 | Background jobs        | IMPLEMENTED | Inngest configured, 6 functions: step reminder, escalation, approval completed, vehicle+driver licence expiry crons, maintenance reminder | ✅ All tenant-isolated, creates notifications                           | MEDIUM   |

---

## Phase 6 — Reporting and Administration

| #   | Module                  | Status      | What Exists                                                                                                                                                  | What's Missing                                                        | Priority |
| --- | ----------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | -------- |
| 6.1 | Reports                 | VERIFIED    | Reports page with 6 live data dashboards (fuel, fleet, trips, maintenance, requests, approvals), time range selector, CSV + Excel export, approval analytics | ✅ All pull real tenant-scoped data                                   | MEDIUM   |
| 6.2 | Audit log               | IMPLEMENTED | Audit events table, audit page with search/filters, hash-chain integrity display                                                                             | Works end-to-end                                                      | MEDIUM   |
| 6.3 | Settings                | IMPLEMENTED | Settings page with 4 tabs (General, Notifications, Security, Branding)                                                                                       | ✅ Tenant profile, branding (colors/footer/email), notification prefs | MEDIUM   |
| 6.4 | Platform administration | IMPLEMENTED | Platform dashboard with tenant stats, tenant list, onboard flow                                                                                              | ✅ Platform admin dashboard + tenant management                       | MEDIUM   |
| 6.5 | Tenant management       | IMPLEMENTED | Tenant detail page with suspend/activate dialog, status badges, PATCH API                                                                                    | ✅ Full lifecycle                                                     | MEDIUM   |
| 6.6 | Data exports            | VERIFIED    | CSV/Excel/PDF export for reports (fuel, fleet, trips, requests, maintenance, approvals), Excel export button on reports page                                 | Fully implemented with 6 report types and 3 export formats            | LOW      |

---

## Phase 7 — Driver Mobile and Offline

| #   | Module                     | Status      | What Exists                                                                                                              | What's Missing                                                 | Priority |
| --- | -------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | -------- |
| 7.1 | Driver mobile workflow     | IMPLEMENTED | Driver mobile view (`/dashboard/driver-mobile`), self-service portal (`/dashboard/driver-self-service`)                  | ✅ Both mobile-optimized views built                           | MEDIUM   |
| 7.2 | Offline inspection drafts  | VERIFIED    | Dexie stores (fuel, transport requests, inspections), offline-sync handler, offline-status component with draft count    | ✅ Auto-sync on reconnect + 60s polling                        | MEDIUM   |
| 7.3 | PWA support                | VERIFIED    | Manifest (icons, shortcuts, standalone display), service worker (network-first API + cache-first static), install banner | ✅ Full PWA                                                    | MEDIUM   |
| 7.4 | Sync and conflict handling | IMPLEMENTED | Offline sync service with pending/synced/failed/conflict states, conflict resolution UI at `/dashboard/offline`          | ✅ Full conflict resolution UI with retry/discard/detail modal | MEDIUM   |

---

## Phase 8 — Final Production Verification

| #   | Module                        | Status      | What Exists                                                                                                                                                                                                                                                         | What's Missing                                                                    | Priority |
| --- | ----------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------- |
| 8.1 | End-to-end testing            | IMPLEMENTED | 10 regional trip workflow E2E tests (Playwright), offline drafts E2E tests, 28 integration tests (auth + documents)                                                                                                                                                 | Full workflow covered                                                             | MEDIUM   |
| 8.2 | Cross-tenant security testing | VERIFIED    | 13 Vitest test cases covering all core entities                                                                                                                                                                                                                     | ✅ All 13 pass                                                                    | HIGH     |
| 8.3 | Permission testing            | VERIFIED    | 10 permission integration tests (code completeness, group coverage, role integrity, orphan detection)                                                                                                                                                               | ✅ All 10 pass                                                                    | MEDIUM   |
| 8.4 | Mobile testing                | VERIFIED    | 7 responsive CSS utilities + 20+ Playwright mobile viewport tests covering 12 pages, sidebar hamburger, fuel form inputs, offline indicator, dark mode toggle, form controls, privacy page                                                                          | All 12 major pages tested for overflow + interactive elements on 375×812 viewport | LOW      |
| 8.5 | Deployment testing            | IMPLEMENTED | Vercel deployment works, Sentry configured                                                                                                                                                                                                                          | Deployed to production                                                            | MEDIUM   |
| 8.6 | Monitoring                    | VERIFIED    | Sentry configured (server + client + edge), monitoring setup guide at `docs/monitoring-setup.md` with alert rules for Sentry + Vercel + uptime + background jobs                                                                                                    | Alert rules documented, Sentry dashboard alerts need manual configuration         | LOW      |
| 8.7 | Documentation                 | IMPLEMENTED | `docs/user-guide.md` — full user guide (transport, approvals, trips, fuel, inspections, notifications, FAQ). `docs/admin-guide.md` — full admin guide (platform, tenants, users, roles, fleet, imports, reports, audit, background jobs, security, troubleshooting) | —                                                                                 | LOW      |

---

## Session History

### Sessions 2–12 ✅ — See CHANGELOG.md for full session details

### Session 13 ✅ — Inspection Detail, Templates, Vehicle Lifecycle

51. **Inspection Detail Page** — `/dashboard/inspections/[id]` with status/summary cards, checklist grouping, defects/photos/notes sections. ✅
52. **Inspection Templates API** — Full CRUD at `/api/inspection-templates` with tenant isolation and permission gating. ✅
53. **Inspection Templates Page** — `/dashboard/inspections/templates` with departure/return tabs, create/edit modal. ✅
54. **Vehicle Lifecycle Wiring** — Trip start → `allocated`, trip close → `available`, inspection auto-close → `available`, maintenance → `maintenance`. All with `vehicleStatusEvents`. ✅
55. **Status Timeline Tab** — Added to vehicle detail page. ✅
56. **Insp. Templates Sidebar** — Added below Inspections in Fleet & Maintenance. ✅
57. **RESEND_API_KEY configured** — Email pipeline ready in Vercel production. ✅

---

## Remaining Gaps (Low-Priority / Blocked)

| #   | Gap                                       | Status      | Blocked By                                                                                       |
| --- | ----------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| 1   | SMS sending (Twilio)                      | DORMANT     | Real Twilio credentials                                                                          |
| 2   | Conflict resolution UI for offline sync   | IMPLEMENTED | Full page at `/dashboard/offline` with list, status filters, detail modal, retry/discard actions |
| 3   | Mobile testing (responsive QA)            | VERIFIED    | 20+ Playwright tests across 12 pages                                                             | —   |
| 4   | Admin/User docs (user guide, admin guide) | IMPLEMENTED | —                                                                                                |
| 5   | Google Maps API key                       | DORMANT     | Google billing account                                                                           |
| 6   | Inspection photos/signatures upload       | VERIFIED    | R2 upload + inspectionPhotos table + signed URL display on detail page                           |

### Session 24 ✅ — E2E Audit Trail Test, Email Notifications for Audit Events, Mobile Test Expansion

1. **E2E Audit Trail Test** (`src/e2e/audit-trail-workflow.spec.ts`) — 5 test cases: fuel→`fuel_created`, maintenance→`maintenance_created`, region CRUD→`region_created/updated/deleted`, cancellation→`request_cancelled`, audit page UI. ✅
2. **Email Notifications for Audit Events** — `fuel_created`, `maintenance_created`, `region_created/updated/deleted` events now create in-app notifications with email delivery to the acting user. ✅
3. **Mobile Test Expansion** — 7 new tests added: sidebar hamburger, fuel form inputs, offline indicator, touch targets, privacy page, form controls. ✅

### Session 25 ✅ — RBAC Permission Enforcement, Audit Logging, Email Templates, Notification Delivery E2E

1. **Permission checks on 9 API routes** — Added `requirePermission` checks to regions, inspections/[id], reimbursements/[id], trips/[id], drivers, share-links, documents/[id]/action, documents/[id]/pdf, routes/calculate, trip-logs. ✅
2. **Audit logging on 5 mutation routes** — Added audit events to trip close/start/return, allocations, documents action. ✅
3. **Email templates for audit events** (`src/emails/audit-notification.tsx`) — 11 new template types: fuel_created, maintenance_created, region_created/updated/deleted, trip_started/returned/closed, allocation_created, document_issued/superseded. ✅
4. **Notification delivery E2E test** (`src/e2e/notification-delivery.spec.ts`) — 5 test cases: fuel→notification, delivery properties, Mark All Read, type filtering, unread count. ✅

### Session 26 ✅ — Trips GET Handler, Driver Sidebar Section, Driver Page Fixes, Excel Export Button

1. **Trips API GET Handler** — Added with `driver_assigned` support (resolves session user → employee → driver profile → allocated trips). Returns backward-compatible `data` + `rows` arrays with mapped field names (`reference`, `vehicleLicence`, `startAt`, `endAt`). ✅
2. **Sidebar Restructured** — New "Driver" group at the top with Driver Console, Driver Self-Service, Daily Logs. Removed duplicate entries from Allocations & Trips and Administration groups. ✅
3. **Driver Page Fixes** — Added `json.data` fallback to driver-self-service and logs pages for robust response parsing. ✅
4. **Excel Export Button** — Added to Reports page alongside existing CSV and PDF buttons. Backed by existing `?export=excel` API endpoint. ✅

### Status Updates

| Module                     | Old Status  | New Status |
| -------------------------- | ----------- | ---------- |
| 1.5 RBAC                   | IMPLEMENTED | VERIFIED   |
| 1.6 API protection         | IMPLEMENTED | VERIFIED   |
| 1.9 Audit logging          | IMPLEMENTED | VERIFIED   |
| 5.2 Email                  | IMPLEMENTED | VERIFIED   |
| 6.6 Data exports           | PARTIAL     | VERIFIED   |
| 8.4 Mobile testing         | PARTIAL     | VERIFIED   |
| 7.1 Driver mobile workflow | IMPLEMENTED | VERIFIED   |

### Session 27 ✅ — Inspection Photo Wiring, Conflict Resolution UI, Sidebar Link

1. **Inspection Photo Wiring** — Inspection detail page (`/dashboard/inspections/[id]`) now generates signed URLs for each uploaded photo via `getSignedFileUrl()` and renders actual `<img>` tags instead of placeholder icons. Falls back to placeholder if storage is not configured or URL generation fails. ✅
2. **Conflict Resolution UI** (`/dashboard/offline`) — Full page with summary cards (pending/failed/conflict/total), status filter tabs, sorted draft list with type/status/error display, detail modal with full form data JSON, and retry/discard actions per draft. "Sync All" button calls `syncPendingDrafts()`. ✅
3. **Sidebar Link** — "Offline Drafts" added to Administration group with Database icon. ✅

### Session 28 ✅ — Single-Draft Retry Sync, Conflict Resolution E2E, Mobile QA

1. **Single-Draft Retry Sync** (`syncSingleDraft` in `offline-sync.ts`) — New function that syncs a single draft by ID using direct IndexedDB primary-key lookup (`getDraft()` instead of `listDrafts()` + `find()`). `syncPendingDrafts` refactored to use `syncSingleDraft` in a loop (no regression). Individual retry buttons on the offline page and detail modal now call `handleRetrySingle(draft.id)` instead of `handleSyncAll`. ✅
2. **Error Handling Fix** — `handleViewDetail` in offline page now wrapped in try/catch to prevent unhandled promise rejection if Dexie throws. ✅
3. **Conflict Resolution E2E Test** (`src/e2e/offline-conflict-resolution.spec.ts`) — 7 test cases: summary cards/empty state on page load, status filter tab clicks, create draft via fuel form → verify on offline page, discard removes draft, view detail modal shows form data, breadcrumbs/header correct, Sync All button state. ✅
4. **Phase 1.8 Secure file access** promoted to VERIFIED — full R2 upload + signed URL pipeline end-to-end. ✅

### Session 29 ✅ — Strict Staff Status / Account Status / Availability Separation

Implemented the three-concept separation per the strict implementation prompt. Staff employment status (ACTIVE/INACTIVE/ARCHIVED), user account status (User Management), and availability are now independent and never conflated.

1. **Shared status model** (`src/lib/employee-status.ts`) — Canonical `EMPLOYEE_STATUSES`, `normaliseEmployeeStatus()` with legacy map (`on_leave`, `retired`, etc.), `employeeStatusConfig` badge config, `AVAILABILITY_OPTIONS`, `accountStatusConfig`. Badges always normalise before colouring — `ACTIVE`/`Active`/`active` all render green "Active". 14 unit tests. ✅
2. **Bulk staff actions** (`src/app/api/employees/bulk/route.ts` + `staff-bulk-bar.tsx` + `bulk-selection.ts`) — Mark Active/Inactive, Set Availability, Assign Office/Department, Archive/Restore. Tenant-scoped WHERE, `STAFF_LIFECYCLE_MANAGE` (+ `STAFF_MANAGE` for office/department), archive requires reason, audit entry per batch. Max 500 rows. `useSyncExternalStore` selection sync. ✅
3. **Lifecycle API separation** (`/api/employees/[id]/lifecycle`) — `status` (active/inactive) never touches accounts; `availability` uses canonical values; new `deactivate_account` / `reactivate_account` / `remove_driver` actions; archive/restore remain destructive (revoke/restore linked account) but are separate actions. ✅
4. **Create + import defaulting** — `/api/employees` and `/api/import` both use the shared normalizer; blank status → `active`, blank availability → `available`; case variants accepted. Import preview shows defaults card (Employment status / Availability / Account: Not created / Driver profile). ✅
5. **Employee Detail** — Account row (`Active` / `No account`) with View Account link; compact staff-status control (Mark Active / Mark Inactive) plus overflow menu (Archive / Restore / Remove Driver / Deactivate Account). ✅
6. **User Management** — Linked employee summary in list and detail pages (Linked employee / Employee number / Staff status / Office / Department + View Employee Profile); invite dropdown only offers ACTIVE employees without an account. ✅
7. **Kavango East data correction** (seed) — Tenant-scoped normalisation of case-variant statuses to `ACTIVE`; never activates archived/suspended; no accounts created; availability and driver authorisation untouched; single audit entry. ✅
8. **Status Updates** — 2.4 Staff management / employee module → IMPLEMENTED; Kavango East correction applied. Acceptance criteria 1–18 all satisfied (new/imported staff default Active; badge consistency; status/account/availability independence; no duplicate person records; audit + tenant isolation verified).

### Session 30 ✅ — Driver Roster with Licence-Expiry Alerts, user:manage-status Boundary, Organisation Status Counts, Enhanced Import Preview

1. **`user:manage-status` permission boundary** (`src/lib/permissions.ts`, lifecycle + admin users routes) — New `USER_VIEW` / `USER_MANAGE_STATUS` / `USER_INVITE` permissions added to the enum, granted in TRANSPORT_ADMIN + TENANT_ADMIN workspace policies and RoleDefinitions. `deactivate_account` / `reactivate_account` in `/api/employees/[id]/lifecycle` and `tenantStatus` PATCH in `/api/admin/users/[id]` are now gated behind `USER_MANAGE_STATUS` — staff-lifecycle rights alone can never toggle a login account. ✅
2. **Driver roster with licence-expiry alerts** (`/api/drivers` + `/dashboard/drivers`) — API now resolves each driver's active licences and computes `nextExpiry` (class, expiry date, days remaining), `hasExpiredLicence`, `hasExpiringLicence` (≤ 60 days), `hasValidLicence`, `noLicence`. Rebuilt roster page: summary cards (Total / Expired / Expiring ≤ 60d / Valid), licence-status filter dropdown, per-driver expiry badges (error → emergency → warning → success by days left), active-licence count, no-licence fallback, search + refresh + filter-reset. ✅
3. **Organisation structure staff-status counts** — `StaffStatusBreakdown` component (active · inactive · archived chips) now rendered in the Organisation page tables + mobile cards (offices and departments) and in the standalone Offices page hierarchy nodes (office + department cards). Counts are computed server-side via grouped `employmentStatus` subqueries, tenant-scoped. ✅
4. **Bulk import preview with row-level errors** (`/dashboard/staff/import`) — Preview now shows a defaults summary card (Employment status → Active, Availability → Available, Account → Not created, Driver profile → No), per-row default chips in the table, expandable per-row error details, and a downloadable CSV error file for rows that failed validation. ✅
5. **Validation** — `pnpm tsc --noEmit` 0 errors; `pnpm lint` 0 errors (3 pre-existing warnings in untouched files); `pnpm vitest run` 265/265 passed. Code review clean — fixed one syntax slip (permission gate inside type annotation) and wired `statusBreakdown` into office hierarchy nodes (was unused).

### Session 31 ✅ — Driver Licence-Expiry Digest Job, Import Preview E2E, Permission Matrix, User Removal, Staff Directory Pagination Fix + Select-All-Across-Pages

1. **Driver licence-expiry admin digest** (`src/lib/inngest/functions.ts`) — New daily cron `driver-licence-expiry-digest` (08:00, registered in `inngestFunctions`) distinct from the per-driver alert: ONE tenant-scoped digest per day to every Transport Administrator listing all driver licences expiring within 60 days or already expired, via `createScopedNotifications` + `sendNotificationEmail`. Idempotent per tenant per day using a day-epoch `eventVersion` key (lookup skips re-sends); non-business days skipped per tenant via `isBusinessDay`; per-email try/catch; archived employees excluded. ✅
2. **Import preview + error file E2E test** (`src/e2e/staff-import-preview.spec.ts`) — Uploads a CSV with 1 valid + 2 error rows; asserts the Defaults card, summary counts (3 total / 1 valid / 2 errors), expandable row-level errors, absence of the import button while errors exist, and downloads the error CSV asserting both failure reasons appear. Playwright **2/2 passed** against the seeded production build. ✅
3. **Permission matrix admin screen** (`/dashboard/admin/roles`) — New Cards/Matrix view toggle. Matrix view renders a live grid (permission groups × roles) with member counts, System badges, and click-to-toggle checkboxes that PATCH `/api/admin/roles` immediately; cells locked during save (`savingCell`), refetch awaited before unlock, group header colSpan correct, permission codes shown per row. ✅
4. **User management removal** (`DELETE /api/admin/users/[id]` + list + detail UI) — Role-less / pending users can be removed from the organisation. Handler enforces `TENANT_MANAGE`, blocks self-removal, verifies the membership is in the caller's tenant (cross-tenant protection), rejects 409 while active role assignments remain (lists role names), unlinks `employees.userId → null` (staff record preserved, still appears in Staff Directory), deletes assignments + membership **inside a `db.transaction()`** (atomicity fix from review), and writes an audit event after the transaction with isolated failure handling. List rows show a trash action enabled only for role-less users (tooltip otherwise) with a confirm dialog; detail page has a danger-zone remove button + explainer when roles must be removed first. ✅
5. **Staff directory pagination persistence fix** (`src/components/ui/live-search-input.tsx`) — Root cause: the debounced navigation effect fired on EVERY `searchParams` change (including the `page` param when clicking Next) and stripped `page`, bouncing back to page 1. Rewrote with a `committedRef`: navigation only fires when the typed value actually differs from the committed one (resetting page 1 then); external URL changes (reset/back/forward/toolbar) are adopted separately; in-flight debounce cancelled on adoption (closes the clear-reset regression window). Clicking Next/Previous now persists. ✅
6. **Select all across all pages + mark active** (`/api/employees/bulk` + `staff-bulk-bar.tsx` + staff page) — Bulk API gained an `allSelected + filter` mode that resolves matching employee IDs **server-side** (strictly tenant-scoped, mirroring the directory query: ilike on name/number/email/jobTitle + eq on office/department/status/availability, 2000-row safety cap). Bulk bar shows "Select all {N} matching filters" (collapsed and active states), flips to "All {N} matching filters" with an "Only on this page" escape, and sends the filter payload so Mark Active (or any action) hits every matching employee on every page. State resets after success. ✅
7. **Validation** — `pnpm tsc --noEmit` 0 errors; `pnpm lint` 0 errors (2 pre-existing warnings in untouched lines of `functions.ts`); `pnpm vitest run` 265/265 passed (23 files); Playwright import-preview spec 2/2 passed. Code review: verified digest job matches existing cron patterns; applied critical fix (transaction in DELETE), matrix refetch-before-unlock, and debounce-cancellation on external adoption.

### Session 32 ✅ — Programme Business Model, Status-Aware Request Actions, Print & Report Exports

1. **Programme module end-to-end** (`src/db/schema/programmes.ts`, migration `0030_programme_management.sql`, `/api/programmes`, `/api/programmes/[id]`, `/api/programmes/[id]/action`, `/dashboard/programmes` + new/edit/detail pages) — Full lifecycle `draft → submitted → changes_requested → approved → published → completed/archived` (plus `rejected`) with server-enforced transitions, per-action permissions (`PROGRAMME_CREATE/VIEW/SUBMIT/REVIEW/APPROVE/REJECT/PUBLISH/ARCHIVE`), tenant-scoped queries with FK-validated department/owner/office/region references, reference generation (`GRN/PGM/…`), COI guard (reviewers cannot approve their own programme), audit events + scoped notifications on every action, linked transport requests shown on the detail page. Repairs the previous 404s on `/dashboard/programmes/[id]`. ✅
2. **Link Programmes to Transport Requests** — `transport_requests.programme_id` column + migration; wizard `ProgrammeSelector` (only approved/published, non-archived programmes); POST validation resolves the programme tenant-scoped and rejects unavailable links; request detail shows a Linked Programme card with status badge and deep link. ✅
3. **Status-aware request actions** — `PATCH /api/requests/[id]/discard` (draft-only, requester-or-`REQUEST_CANCEL`, preserves record as `cancelled`, audit event) + `DiscardDraftButton` (shown only for drafts) on the request detail page; Cancel button now only renders for non-draft requests. ✅
4. **My Requests vs Requests view toggle** — Requests list gains an All Requests / My Requests toggle for tenant-scoped users (`view=mine|all` query param forces `recordScope: 'self'`), preserving filters and resetting pagination. ✅
5. **COI surfaced in approval UI** — When the viewer is the requester of a request they're reviewing, the approval detail page now shows a "Conflict of interest — you requested this trip" warning alert explaining why self-approval is blocked (backend already enforced it; the UI now explains it). ✅
6. **Report exports** — `/api/reports/enhanced` now accepts `export=csv|excel|pdf` (CSV/Excel via `exportToCSV`/`exportToExcel`; PDF via new `src/lib/pdf/enhanced-report.tsx` with themed branded cover + `Page X of Y` footer); Reports frontend `handleExport` downloads blobs with error toasts; all six report buttons + print use the shared export path. ✅
7. **Print support** — `@media print` rules in `globals.css` (`#print-report` only, `.no-print` hidden, surface/ink color-scheme swap, `print-color-adjust: exact`); reports page wraps content in `#print-report` with `no-print` on chrome (header, selector, filters, buttons); Print button calls `window.print()`. ✅
8. **Page numbering** — Shared `ReportDocument` footer now renders `Page X of Y` (was `Page X`). ✅
9. **Validation** — `pnpm tsc --noEmit` 0 errors; `pnpm lint` 0 errors (3 pre-existing warnings in untouched files); `pnpm vitest run` 265/265 passed (23 files). Fixed during review: `danger`→`destructive` Button variant, `EmptyState` href actions, missing `useToast`, notification category `system`→`awareness`, effect set-state lint, memoization deps. ✅

### Session 33 ✅ — WhatsApp Share Actions, Allocation Emails, Fleet Report Export, Driver Dashboard Metrics, Programme E2E Test

1. **Fleet report export** (`src/app/api/reports/route.ts`) — `/api/reports?type=fleet&export=csv|excel|pdf` previously fell through to an empty default. Added tenant-scoped fleet rows (licenceNumber, make/model, category, colour, status, odometer, licence expiry, roadworthy test date, assigned office/region) and CSV/Excel/PDF cases in the export switches. ✅
2. **WhatsApp share on share-links dashboard** (`/api/share-links` + `/dashboard/share-links`) — List API now returns `shortSlug`; the dashboard rows gained per-link Copy-link and WhatsApp share buttons (device `https://wa.me/?text=` deep link) alongside the existing revoke action. ✅
3. **Allocation emails** (`/api/allocations` + `/api/allocations/[id]/driver`) — Allocation creation now sends an `allocation_created` email to the requester (and the assigned driver when driverEmployeeId is set); driver assignment sends a driver-assignment email. Uses the existing `sendNotificationEmail` + template registry (no new infra). ✅
4. **Driver licence-expiry job bug fix** (`src/lib/inngest/functions.ts`) — `notificationPreferences` lookup matched `userId` against `l.email`; corrected to `l.userId` so preferences actually gate the alert. ✅
5. **Driver dashboard metrics** (`src/app/(dashboard)/dashboard/page.tsx`) — DRIVER workspace now shows Trips due for return (status `return_due`/`in_progress`) and My fuel records (30d) alongside My active trips. ✅
6. **Programme E2E test** (`src/e2e/programme-workflow.spec.ts`) — New Playwright spec following the role-isolation pattern: admin creates a programme, submits it, reviewer approves, requester links it to a transport request, and the request detail shows the Linked Programme card. ✅
7. **Validation** — `pnpm tsc --noEmit` 0 errors; `pnpm lint` 0 errors (3 pre-existing warnings in untouched files); `pnpm vitest run` 265/265 passed (23 files).

### Session 34 ✅ — Email Coverage in Background Jobs, Offline Inspection Sync Idempotency, Playwright Verification

1. **Emails wired into background jobs** (`src/lib/inngest/functions.ts`) — Added a shared `emailUserIds` helper (tenant-scoped, respects `notificationPreferences.emailNotifications`, mirrors the driver-licence job pattern) and wired it into six jobs that previously only created in-app notifications: `stepReminder` (approval_due_reminder → assigned approver), `stepEscalation` (approval_overdue_escalation → assignee), `approvalCompleted` (request_approved/rejected → requester with correct template type), `vehicleLicenceExpiryAlert` (→ fleet managers), `maintenanceReminder` (→ fleet managers), and `documentExpiryAlert` (→ document controllers). ✅
2. **Offline inspection sync idempotency** — `vehicle_inspections` gained `client_sync_id` (schema + hand-written migration `0031_vehicle_inspection_sync.sql` + `_journal.json` entry, matching the fuel/trip-logs/progress/expenses/incidents pattern). `POST /api/inspections` now dedupes by `(tenantId, tripId, clientSyncId)` returning `{ idempotent: true }` for resubmissions; `syncSingleDraft` in `src/lib/offline-sync.ts` passes `clientSyncId` through so retries can't double-submit. Unique index `uq_vehicle_inspections_tenant_sync` enforces the constraint at the DB level. ✅
3. **Playwright verification** — Fixed `src/e2e/programme-workflow.spec.ts` rejection-path ordering bug (the API correctly returns 409 for `reject` on a `draft` — invalid transition — so the no-reason 400 assertion must run after `submit`). Ran `programme-workflow` (7/7), `offline-drafts` (7/7) and `offline-conflict-resolution` (7/7) specs against a fresh production build + e2e seed — all 21 passed. Migration 0031 verified applied (`client_sync_id` present on `vehicle_inspections`). ✅
4. **Validation** — `pnpm tsc --noEmit` 0 errors; `pnpm lint` 0 errors (3 pre-existing warnings in untouched files); `pnpm vitest run` 265/265 passed (23 files).

---

## How to Use This Roadmap

1. At the start of each session, read this file
2. Find the highest-priority incomplete item in the earliest incomplete phase
3. Verify the status in the actual codebase (don't trust the status blindly)
4. Implement it end-to-end
5. Update the status in this file
6. Update PROJECT-STATUS.md
7. Continue to the next item
