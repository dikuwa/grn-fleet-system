# GovFleet Namibia — Implementation Roadmap

> **Last updated:** 2026-07-20
> **Working branch:** `master`
> **Database:** Neon Postgres (migrated, seeded)
> **Deployment:** https://grn-fleet-system.vercel.app

This document is the permanent execution plan for every coding session. Read it before implementing any new work.

---

## Status Legend

| Status | Meaning |
|--------|---------|
| NOT STARTED | No work has been done |
| PARTIAL | Some work done but not end-to-end functional |
| IMPLEMENTED | Module works through its core workflow |
| VERIFIED | Tested through end-to-end workflow with automated tests |
| BLOCKED | Cannot proceed due to missing credential or dependency |

---

## Phase 1 — Security and Data Protection

| # | Module | Status | What Exists | What's Missing | Priority |
|---|--------|--------|-------------|----------------|----------|
| 1.1 | Authentication | VERIFIED | Better Auth custom handler, session management, sign-in/sign-out, tenant membership resolution | — | CRITICAL |
| 1.2 | Route protection | VERIFIED | `src/proxy.ts` (Next.js 16 middleware), redirects to `/login`, `getServerSession()` on every server page | All server pages check auth before rendering | CRITICAL |
| 1.3 | Server-side session validation | VERIFIED | `requireRequestAuth`, `requireAuth` helpers, `getServerSession()` on all server pages | Fully implemented | CRITICAL |
| 1.4 | Tenant isolation | VERIFIED | All server pages filter by `tenantId` from session | 13 cross-tenant security tests pass | CRITICAL |
| 1.5 | Role-based access control | VERIFIED | Full permission system (`Permissions`, `RoleDefinitions`, `auth-helpers`), 14 permission groups + 9+ additional GET route checks (trip-logs, drivers, inspections, trips, reimbursements, documents, share-links, routes, regions) | — | HIGH |
| 1.6 | API and server-action protection | VERIFIED | All 30+ API mutation routes checked (requireRequestAuth + requirePermission where mutation), all GET routes checked for view permissions | — | HIGH |
| 1.7 | Database constraints | VERIFIED | Drizzle schema, proper foreign keys, migration 0004 aligned DB with schema | — | MEDIUM |
| 1.8 | Secure file access | VERIFIED | R2 storage service, photo upload API, inspection photo signed URLs, tenant-scoped file keys | ✅ Full pipeline: capture → R2 upload → inspectionPhotos table → signed URL display on detail page | MEDIUM |
| 1.9 | Audit logging | VERIFIED | Audit events table, hash-chain support, WorkflowEngine logs actions, 12+ mutation routes log audit events (fuel, maintenance, regions, requests, trips/start/return/close, allocations, documents) | — | MEDIUM |

---

## Phase 2 — Core Organisation Setup

| # | Module | Status | What Exists | What's Missing | Priority |
|---|--------|--------|-------------|----------------|----------|
| 2.1 | Platform administration | IMPLEMENTED | Platform dashboard, tenant list/detail, onboard API, platform admin seed | ✅ Tenant list, detail with suspend/activate, platform dashboard | HIGH |
| 2.2 | Multi-tenant onboarding | IMPLEMENTED | POST `/api/platform/onboard` — creates tenant, branding, offices, departments, roles | Works end-to-end | HIGH |
| 2.3 | Tenant administration | IMPLEMENTED | Tenant detail page with suspend/activate dialog, status badges, PATCH API | ✅ Full lifecycle management | HIGH |
| 2.4 | Regions | IMPLEMENTED | `regions` table, RESTful CRUD API, management page at `/dashboard/admin/regions` | ✅ Full CRUD with active/inactive status | MEDIUM |
| 2.5 | Offices | IMPLEMENTED | Office tree, `OfficeDialog` (create/edit), seed data, office filter in fleet | ✅ Create/edit dialog works | HIGH |
| 2.6 | Departments | IMPLEMENTED | Seed data, department filter in staff, sidebar Departments link | ✅ Sidebar link added | MEDIUM |
| 2.7 | Users | IMPLEMENTED | Admin user list/detail, invite dialog, PATCH API for role/status updates | ✅ User invite flow, detail page with role/status management | HIGH |
| 2.8 | Roles | VERIFIED | 9 default roles, Role Editor UI with permission matrix, create/edit dialogs | ✅ Full permission matrix with 14 groups | MEDIUM |
| 2.9 | Permissions | VERIFIED | All permission codes, groups, seed, Permission matrix in Role Editor | ✅ Verified with 10 integration tests | MEDIUM |
| 2.10 | Initial tenant configuration | VERIFIED | Seed creates Kavango East with full setup | Works for first tenant | HIGH |

---

## Phase 3 — Core Transport Workflow

| # | Module | Status | What Exists | What's Missing | Priority |
|---|--------|--------|-------------|----------------|----------|
| 3.1 | Transport request | IMPLEMENTED | 5-step wizard, API route, DB schema (requests, activities, passengers, drivers, routes, attachments) | Request detail page with all child records | HIGHEST |
| 3.2 | Approval workflow | VERIFIED | WorkflowEngine class, regional/national definitions, action processing, separation of duty, emergency override, 10 E2E tests | ✅ Full approval → trip workflow tested | HIGHEST |
| 3.3 | Maps and routes | VERIFIED | RouteCalculator (Google Maps), graceful fallback, route form in wizard, route map visualization on request detail page, E2E route calculation test | — | HIGH |
| 3.4 | Vehicle recommendation | VERIFIED | VehicleRecommender class (deterministic scoring), category/terrain/passenger matching | ✅ Wired into allocation UI with scores/reasons | HIGH |
| 3.5 | Vehicle allocation | IMPLEMENTED | Allocations list (DB-backed), allocation schema, API route, recommendation UI, DriverAssignment component | ✅ Show scored recommendations, driver assign/unassign | HIGH |
| 3.6 | Driver assignment | IMPLEMENTED | Full `DriverAssignment` component at allocation detail, assign/unassign API, driver detail page with licence/assignment history | ✅ Complete driver management flow | HIGH |
| 3.7 | Trip creation | IMPLEMENTED | Trip schema, trip list, trip detail with TripActions, trip creation from allocation | ✅ Full workflow: allocation → trip | HIGH |
| 3.8 | Departure inspection | IMPLEMENTED | Inspection schema, departure inspection page at `/dashboard/inspections/new?type=departure` | ✅ 16-item checklist across 7 categories | HIGH |
| 3.9 | Active trip | IMPLEMENTED | Active trips page at `/dashboard/trips/active` with real-time duration tracking, status breakdown | ✅ Full active trip tracking UI | HIGH |
| 3.10 | Arrival inspection | IMPLEMENTED | Return inspection at `/dashboard/inspections/new?type=return`, auto-closes trip on pass | ✅ 9-item return checklist | HIGH |
| 3.11 | Trip completion | IMPLEMENTED | Trip close API with closure review, closure review page at `/dashboard/trips/closure-review` with approve/reject | ✅ Full closure workflow | HIGH |

---

## Phase 4 — Fleet Operations

| # | Module | Status | What Exists | What's Missing | Priority |
|---|--------|--------|-------------|----------------|----------|
| 4.1 | Fleet management | VERIFIED | Fleet list with search/filters/pagination, vehicle detail with 6 tabs, new/edit vehicle forms, vehicle import wizard | ✅ Full fleet management | HIGH |
| 4.2 | Driver management | VERIFIED | Driver list, detail page with licences (expiry status), assignment history, driver mobile view, self-service portal | ✅ Complete driver management | MEDIUM |
| 4.3 | Fuel management | IMPLEMENTED | Fuel list, new entry with offline draft support, fuel API, reimbursement API | Works end-to-end | HIGH |
| 4.4 | Maintenance | IMPLEMENTED | Maintenance events in vehicle detail, maintenance list page, POST API, maintenance form (`/dashboard/maintenance/new`) | ✅ Frontend form + API + vehicle lifecycle | MEDIUM |
| 4.5 | Vehicle compliance | IMPLEMENTED | Compliance API, colour-coded compliance cards at `/dashboard/fleet/compliance` | ✅ Full compliance tracking with expiry timeline | MEDIUM |
| 4.6 | Expiry alerts | IMPLEMENTED | Expiry alerts dashboard at `/dashboard/expiry-alerts`, Inngest crons for licence/roadworthy/insurance expiry | ✅ Driver + vehicle licence expiry alerts | MEDIUM |
| 4.7 | Imports and exports | IMPLEMENTED | Staff + vehicle 4-step CSV import wizards, vehicle import template, batch tracking | ✅ Full import flow for both entities | MEDIUM |

---

## Phase 5 — Communication and Documents

| # | Module | Status | What Exists | What's Missing | Priority |
|---|--------|--------|-------------|----------------|----------|
| 5.1 | Notifications (in-app) | VERIFIED | Notifications schema, WorkflowEngine creates notifications, notifications list with filters, topbar with live unread count (30s polling) | ✅ Live badge, Mark All Read, action links | HIGH |
| 5.2 | Email | IMPLEMENTED | Email service (Resend), 8 React Email templates, WorkflowEngine sends email, graceful fallback, RESEND_API_KEY configured | ✅ Full pipeline ready | MEDIUM |
| 5.3 | WhatsApp share | IMPLEMENTED | Native share via Web Share API with clipboard fallback, wired into document detail page | ✅ Works on mobile devices | LOW |
| 5.4 | Secure share links | IMPLEMENTED | Share link API (create/revoke), HMAC-SHA256 token hashing, view tracking, create-share-link dialog on document detail | ✅ Full share link management | MEDIUM |
| 5.5 | PDF generation | IMPLEMENTED | Document generator with builder pattern, 4 snapshot builders, lifecycle triggers on request/trip/inspection events | ✅ 6 document types generated | HIGH |
| 5.6 | File uploads | VERIFIED | Upload API (`/api/upload`), R2 storage service, document file upload flow, inspection photo upload wired with signed URLs on detail page | ✅ Full photo pipeline: capture → upload → inspect → signed URL display | MEDIUM |
| 5.7 | Background jobs | IMPLEMENTED | Inngest configured, 6 functions: step reminder, escalation, approval completed, vehicle+driver licence expiry crons, maintenance reminder | ✅ All tenant-isolated, creates notifications | MEDIUM |

---

## Phase 6 — Reporting and Administration

| # | Module | Status | What Exists | What's Missing | Priority |
|---|--------|--------|-------------|----------------|----------|
| 6.1 | Reports | VERIFIED | Reports page with 6 live data dashboards (fuel, fleet, trips, maintenance, requests, approvals), time range selector, CSV + Excel export, approval analytics | ✅ All pull real tenant-scoped data | MEDIUM |
| 6.2 | Audit log | IMPLEMENTED | Audit events table, audit page with search/filters, hash-chain integrity display | Works end-to-end | MEDIUM |
| 6.3 | Settings | IMPLEMENTED | Settings page with 4 tabs (General, Notifications, Security, Branding) | ✅ Tenant profile, branding (colors/footer/email), notification prefs | MEDIUM |
| 6.4 | Platform administration | IMPLEMENTED | Platform dashboard with tenant stats, tenant list, onboard flow | ✅ Platform admin dashboard + tenant management | MEDIUM |
| 6.5 | Tenant management | IMPLEMENTED | Tenant detail page with suspend/activate dialog, status badges, PATCH API | ✅ Full lifecycle | MEDIUM |
| 6.6 | Data exports | VERIFIED | CSV/Excel/PDF export for reports (fuel, fleet, trips, requests, maintenance, approvals), Excel export button on reports page | Fully implemented with 6 report types and 3 export formats | LOW |

---

## Phase 7 — Driver Mobile and Offline

| # | Module | Status | What Exists | What's Missing | Priority |
|---|--------|--------|-------------|----------------|----------|
| 7.1 | Driver mobile workflow | IMPLEMENTED | Driver mobile view (`/dashboard/driver-mobile`), self-service portal (`/dashboard/driver-self-service`) | ✅ Both mobile-optimized views built | MEDIUM |
| 7.2 | Offline inspection drafts | VERIFIED | Dexie stores (fuel, transport requests, inspections), offline-sync handler, offline-status component with draft count | ✅ Auto-sync on reconnect + 60s polling | MEDIUM |
| 7.3 | PWA support | VERIFIED | Manifest (icons, shortcuts, standalone display), service worker (network-first API + cache-first static), install banner | ✅ Full PWA | MEDIUM |
| 7.4 | Sync and conflict handling | IMPLEMENTED | Offline sync service with pending/synced/failed/conflict states, conflict resolution UI at `/dashboard/offline` | ✅ Full conflict resolution UI with retry/discard/detail modal | MEDIUM |

---

## Phase 8 — Final Production Verification

| # | Module | Status | What Exists | What's Missing | Priority |
|---|--------|--------|-------------|----------------|----------|
| 8.1 | End-to-end testing | IMPLEMENTED | 10 regional trip workflow E2E tests (Playwright), offline drafts E2E tests, 28 integration tests (auth + documents) | Full workflow covered | MEDIUM |
| 8.2 | Cross-tenant security testing | VERIFIED | 13 Vitest test cases covering all core entities | ✅ All 13 pass | HIGH |
| 8.3 | Permission testing | VERIFIED | 10 permission integration tests (code completeness, group coverage, role integrity, orphan detection) | ✅ All 10 pass | MEDIUM |
| 8.4 | Mobile testing | VERIFIED | 7 responsive CSS utilities + 20+ Playwright mobile viewport tests covering 12 pages, sidebar hamburger, fuel form inputs, offline indicator, dark mode toggle, form controls, privacy page | All 12 major pages tested for overflow + interactive elements on 375×812 viewport | LOW |
| 8.5 | Deployment testing | IMPLEMENTED | Vercel deployment works, Sentry configured | Deployed to production | MEDIUM |
| 8.6 | Monitoring | VERIFIED | Sentry configured (server + client + edge), monitoring setup guide at `docs/monitoring-setup.md` with alert rules for Sentry + Vercel + uptime + background jobs | Alert rules documented, Sentry dashboard alerts need manual configuration | LOW |
| 8.7 | Documentation | IMPLEMENTED | `docs/user-guide.md` — full user guide (transport, approvals, trips, fuel, inspections, notifications, FAQ). `docs/admin-guide.md` — full admin guide (platform, tenants, users, roles, fleet, imports, reports, audit, background jobs, security, troubleshooting) | — | LOW |

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

| # | Gap | Status | Blocked By |
|---|-----|--------|------------|
| 1 | SMS sending (Twilio) | DORMANT | Real Twilio credentials |
| 2 | Conflict resolution UI for offline sync | IMPLEMENTED | Full page at `/dashboard/offline` with list, status filters, detail modal, retry/discard actions |
| 3 | Mobile testing (responsive QA) | VERIFIED | 20+ Playwright tests across 12 pages | — |
| 4 | Admin/User docs (user guide, admin guide) | IMPLEMENTED | — |
| 5 | Google Maps API key | DORMANT | Google billing account |
| 6 | Inspection photos/signatures upload | VERIFIED | R2 upload + inspectionPhotos table + signed URL display on detail page |

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

| Module | Old Status | New Status |
|--------|-----------|------------|
| 1.5 RBAC | IMPLEMENTED | VERIFIED |
| 1.6 API protection | IMPLEMENTED | VERIFIED |
| 1.9 Audit logging | IMPLEMENTED | VERIFIED |
| 5.2 Email | IMPLEMENTED | VERIFIED |
| 6.6 Data exports | PARTIAL | VERIFIED |
| 8.4 Mobile testing | PARTIAL | VERIFIED |
| 7.1 Driver mobile workflow | IMPLEMENTED | VERIFIED |

### Session 27 ✅ — Inspection Photo Wiring, Conflict Resolution UI, Sidebar Link

1. **Inspection Photo Wiring** — Inspection detail page (`/dashboard/inspections/[id]`) now generates signed URLs for each uploaded photo via `getSignedFileUrl()` and renders actual `<img>` tags instead of placeholder icons. Falls back to placeholder if storage is not configured or URL generation fails. ✅
2. **Conflict Resolution UI** (`/dashboard/offline`) — Full page with summary cards (pending/failed/conflict/total), status filter tabs, sorted draft list with type/status/error display, detail modal with full form data JSON, and retry/discard actions per draft. "Sync All" button calls `syncPendingDrafts()`. ✅
3. **Sidebar Link** — "Offline Drafts" added to Administration group with Database icon. ✅

### Session 28 ✅ — Single-Draft Retry Sync, Conflict Resolution E2E, Mobile QA

1. **Single-Draft Retry Sync** (`syncSingleDraft` in `offline-sync.ts`) — New function that syncs a single draft by ID using direct IndexedDB primary-key lookup (`getDraft()` instead of `listDrafts()` + `find()`). `syncPendingDrafts` refactored to use `syncSingleDraft` in a loop (no regression). Individual retry buttons on the offline page and detail modal now call `handleRetrySingle(draft.id)` instead of `handleSyncAll`. ✅
2. **Error Handling Fix** — `handleViewDetail` in offline page now wrapped in try/catch to prevent unhandled promise rejection if Dexie throws. ✅
3. **Conflict Resolution E2E Test** (`src/e2e/offline-conflict-resolution.spec.ts`) — 7 test cases: summary cards/empty state on page load, status filter tab clicks, create draft via fuel form → verify on offline page, discard removes draft, view detail modal shows form data, breadcrumbs/header correct, Sync All button state. ✅
4. **Phase 1.8 Secure file access** promoted to VERIFIED — full R2 upload + signed URL pipeline end-to-end. ✅

---

## How to Use This Roadmap

1. At the start of each session, read this file
2. Find the highest-priority incomplete item in the earliest incomplete phase
3. Verify the status in the actual codebase (don't trust the status blindly)
4. Implement it end-to-end
5. Update the status in this file
6. Update PROJECT-STATUS.md
7. Continue to the next item
