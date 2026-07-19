# GovFleet Namibia — Implementation Roadmap

> **Last updated:** 2026-07-19
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
| 1.1 | Authentication | IMPLEMENTED | Better Auth custom handler, session management, sign-in/sign-out, tenant membership resolution | — | CRITICAL |
| 1.2 | Route protection | IMPLEMENTED | `src/proxy.ts` (Next.js 16 middleware), redirects to `/login`, plus `getServerSession()` check on every server page | All server pages now check auth before rendering | CRITICAL |
| 1.3 | Server-side session validation | IMPLEMENTED | `requireRequestAuth`, `requireAuth` helpers plus direct `getServerSession()` calls on all server pages | Fully implemented across all pages | CRITICAL |
| 1.4 | Tenant isolation | IMPLEMENTED | Every server page now filters queries by `tenantId` from `getServerSession()`. Pages: requests list/detail, fleet, staff, approvals, trips list/detail, fuel, inspections, allocations list/detail | All 15 server component pages now enforce tenant isolation | CRITICAL |
| 1.5 | Role-based access control | IMPLEMENTED | Full permission system (`Permissions`, `RoleDefinitions`, `auth-helpers`), seed data | Not enforced on dashboard pages | HIGH |
| 1.6 | API and server-action protection | PARTIAL | Some API routes use `requireRequestAuth` | Many routes don't filter by tenant or check permissions | HIGH |
| 1.7 | Database constraints | IMPLEMENTED | Drizzle schema, proper foreign keys | — | MEDIUM |
| 1.8 | Secure file access | PARTIAL | R2 storage service exists | Not fully wired to upload/download flows | MEDIUM |
| 1.9 | Audit logging | IMPLEMENTED | Audit events table, hash-chain support, WorkflowEngine logs actions | Not all mutations log audit events | MEDIUM |

---

## Phase 2 — Core Organisation Setup

| # | Module | Status | What Exists | What's Missing | Priority |
|---|--------|--------|-------------|----------------|----------|
| 2.1 | Platform administration | PARTIAL | Platform tenant list, onboard API, platform admin seed | Platform admin pages incomplete, no tenant suspension UI | HIGH |
| 2.2 | Multi-tenant onboarding | IMPLEMENTED | POST `/api/platform/onboard` — creates tenant, branding, offices, departments, roles | Works end-to-end | HIGH |
| 2.3 | Tenant administration | PARTIAL | Tenant detail page, PATCH API | Edit tenant details, activate/suspend not wired | HIGH |
| 2.4 | Regions | NOT STARTED | Schema may support | Need to create region management UI | MEDIUM |
| 2.5 | Offices | IMPLEMENTED | Office tree, seed data, office filter in fleet | Need office management UI (create/edit) | HIGH |
| 2.6 | Departments | IMPLEMENTED | Seed data, department filter in staff | Need department management UI | MEDIUM |
| 2.7 | Users | PARTIAL | Admin user list/detail, Better Auth tables | Role assignment UI, user invitation flow, password reset | HIGH |
| 2.8 | Roles | IMPLEMENTED | 9 default roles with permissions, role-permission mapping in seed | Need role management UI | MEDIUM |
| 2.9 | Permissions | IMPLEMENTED | All permission codes, groups, seed | Need permission matrix UI | MEDIUM |
| 2.10 | Initial tenant configuration | IMPLEMENTED | Seed creates Kavango East with full setup | Works for first tenant | HIGH |

---

## Phase 3 — Core Transport Workflow

| # | Module | Status | What Exists | What's Missing | Priority |
|---|--------|--------|-------------|----------------|----------|
| 3.1 | Transport request | IMPLEMENTED | 5-step wizard, API route, DB schema (requests, activities, passengers, drivers, routes, attachments) | Request detail page exists with all child records | HIGHEST |
| 3.2 | Approval workflow | IMPLEMENTED | WorkflowEngine class, regional/national definitions, action processing, separation of duty, emergency override | Wired through approval detail/action pages | HIGHEST |
| 3.3 | Maps and routes | PARTIAL | RouteCalculator (Google Maps), graceful fallback, route form in wizard | Google Maps API key not configured — shows manual entry fallback | HIGH |
| 3.4 | Vehicle recommendation | IMPLEMENTED | VehicleRecommender class (deterministic scoring), category/terrain/passenger matching | Now wired into allocation UI with score/reasons/concerns display | HIGH |
| 3.5 | Vehicle allocation | IMPLEMENTED | Allocations list (DB-backed), allocation schema, API route, recommendation UI | New allocation page shows scored recommendations with selection | HIGH |
| 3.6 | Driver assignment | PARTIAL | Driver fields in request form, driver detail in request | Full driver management flow not complete | HIGH |
| 3.7 | Trip creation | PARTIAL | Trip schema, trip list page | Trip creation from approved allocation not wired | HIGH |
| 3.8 | Departure inspection | PARTIAL | Inspection schema, departure inspection page exists | Need to verify full checklist, photo upload, signatures | HIGH |
| 3.9 | Active trip | NOT STARTED | Trip status schema | No active trip tracking UI | HIGH |
| 3.10 | Arrival inspection | PARTIAL | Inspection schema, return inspection page exists | Need to verify completeness | HIGH |
| 3.11 | Trip completion | PARTIAL | Trip closure schema | Closure workflow not fully integrated | HIGH |

---

## Phase 4 — Fleet Operations

| # | Module | Status | What Exists | What's Missing | Priority |
|---|--------|--------|-------------|----------------|----------|
| 4.1 | Fleet management | IMPLEMENTED | Fleet list with search/filters/pagination, vehicle detail with tabs (documents, defects, maintenance, odometer), new vehicle form, edit page | Works end-to-end | HIGH |
| 4.2 | Driver management | IMPLEMENTED | Dedicated driver list page, detail page with profiles/licences/assignment history, linked from sidebar. Drivers list with search, status badges, active licence counts. Detail page shows licences (with expiry status), profile, assignment history via trip logs. | Works end-to-end. Driver list links to /dashboard/drivers/[id]. Detail page links to full staff profile. | MEDIUM | ✅
| 4.3 | Fuel management | IMPLEMENTED | Fuel list, new entry with offline draft support, fuel API, reimbursement API | Works end-to-end | HIGH |
| 4.4 | Maintenance | IMPLEMENTED | Maintenance events in vehicle detail, maintenance list page (server component with filters, pagination, summary stats), POST /api/maintenance endpoint with validation and tenant isolation | Create via API works. Need frontend form for adding events. | MEDIUM | ✅
| 4.5 | Vehicle compliance | PARTIAL | Roadworthy/expiry dates on vehicles | Expiry alerts not implemented | MEDIUM |
| 4.6 | Expiry alerts | NOT STARTED | — | Licence, roadworthy, insurance expiry notifications | MEDIUM |
| 4.7 | Imports and exports | PARTIAL | CSV import wizard (staff), import API | Vehicle import, Excel import, export not complete | MEDIUM |

---

## Phase 5 — Communication and Documents

| # | Module | Status | What Exists | What's Missing | Priority |
|---|--------|--------|-------------|----------------|----------|
| 5.1 | Notifications (in-app) | IMPLEMENTED | Notifications schema, WorkflowEngine creates notifications, notifications list page, topbar with live unread count (30s polling) | Live unread count badge in topbar with auto-polling | HIGH |
| 5.2 | Email | PARTIAL | Email service (Resend), WorkflowEngine tries to send email | No email templates, Resend key not configured | MEDIUM |
| 5.3 | WhatsApp share | NOT STARTED | — | Native share/WhatsApp open via device share sheet | LOW |
| 5.4 | Secure share links | PARTIAL | Share link API (create/revoke), share token hashing | Not fully wired to document UI | MEDIUM |
| 5.5 | PDF generation | PARTIAL | Document generator engine, React PDF templates exist | Need to verify all PDF templates work end-to-end | HIGH |
| 5.6 | File uploads | PARTIAL | Upload API, storage service | Inspection photos, signatures not wired | MEDIUM |
| 5.7 | Background jobs | IMPLEMENTED | Inngest configured, 6 functions registered. Step reminder, step escalation, approval completed, vehicle licence expiry cron, driver licence expiry cron, maintenance reminder cron. | All functions handle tenant isolation via joins, create notifications. Need RESEND_API_KEY for email. Crons run daily (08:00) and weekly (Monday 08:00). | MEDIUM | ✅ |

---

## Phase 6 — Reporting and Administration

| # | Module | Status | What Exists | What's Missing | Priority |
|---|--------|--------|-------------|----------------|----------|
| 6.1 | Reports | IMPLEMENTED | Reports page with 6 live data dashboards (fuel, fleet, trips, maintenance, requests, approvals). Time range selector (7d/30d/90d/1y/custom). StatCards with KPI values. Live Data badge. CSV export button, server-side CSV/Excel export via /api/reports?export=csv|excel&type=... using exceljs library. Print button. Loading/error/empty states. Approval analytics (avg time, action breakdown, steps histogram). | All sections pull real tenant-scoped data. Server-side CSV + Excel export for fuel/trips/requests/maintenance/approvals. | MEDIUM | ✅ |
| 6.2 | Audit log | IMPLEMENTED | Audit events table, audit page with search/filters | Works end-to-end | MEDIUM |
| 6.3 | Settings | PARTIAL | Settings page exists | Need to verify tenant profile, branding, notification prefs | MEDIUM |
| 6.4 | Platform administration | PARTIAL | Tenant list, onboard | Need tenant management dashboard | MEDIUM |
| 6.5 | Tenant management | PARTIAL | Tenant CRUD API | Need full lifecycle (suspend, activate, delete) | MEDIUM |
| 6.6 | Data exports | NOT STARTED | — | CSV/Excel export for all modules | LOW |

---

## Phase 7 — Driver Mobile and Offline

| # | Module | Status | What Exists | What's Missing | Priority |
|---|--------|--------|-------------|----------------|----------|
| 7.1 | Driver mobile workflow | PARTIAL | PWA manifest, service worker, offline draft support | No dedicated driver mobile view | MEDIUM |
| 7.2 | Offline inspection drafts | IMPLEMENTED | Dexie stores, offline-sync handler, offline-status component | Works | MEDIUM |
| 7.3 | PWA support | IMPLEMENTED | Manifest, service worker, install banner | Works | MEDIUM |
| 7.4 | Sync and conflict handling | PARTIAL | Offline sync service | Conflict resolution UI not fully implemented | MEDIUM |

---

## Phase 8 — Final Production Verification

| # | Module | Status | What Exists | What's Missing | Priority |
|---|--------|--------|-------------|----------------|----------|
| 8.1 | End-to-end testing | PARTIAL | Auth + documents integration tests, offline E2E tests | No full workflow E2E tests | MEDIUM |
| 8.2 | Cross-tenant security testing | NOT STARTED | — | Need tests for tenant isolation | HIGH |
| 8.3 | Permission testing | NOT STARTED | — | Need permission matrix tests | MEDIUM |
| 8.4 | Mobile testing | NOT STARTED | — | Need mobile testing | LOW |
| 8.5 | Deployment testing | PARTIAL | Vercel deployment works | Need to run full regression | MEDIUM |
| 8.6 | Monitoring | PARTIAL | Sentry configured | Need proper alerting | LOW |
| 8.7 | Documentation | NOT STARTED | — | User guide, admin guide, deployment docs | LOW |

---

## Current Implementation Priorities

### Session 2 ✅
1. **Create roadmap** ✅
2. **Dashboard DB-backed with tenant isolation** ✅
3. **Auth + tenant isolation on all 15 server pages** ✅
4. **Vehicle recommendation in allocation UI** ✅
5. **Trip workflow APIs (start/return/close) + TripActions** ✅
6. **Notifications indicator in topbar** ✅
7. **Approval Action API verified** ✅

### Session 5 ✅
11. **Reports live data + CSV/Excel export** — ✅
12. **Inngest expiry alert crons** — ✅
13. **Driver management list page** — ✅
14. **Approval analytics dashboard** — ✅
15. **E2E test coverage** — 8 test cases ✅

### Session 6 ✅
16. **Driver Detail page** — Full profile, licence management with expiry detection, assignment history via trip log entries, link to staff detail ✅
17. **Maintenance CRUD API** — POST /api/maintenance with validation and tenant isolation ✅
18. **Reimbursements workflow** — Detail page with approve/reject/pay actions, state transition validation, GET API with tenant isolation ✅
19. **Vehicle Defect Resolution API** — POST /api/defects/[id]/resolve with tenant isolation, blocking enforcement in departure inspection (409 if unresolved blocking defects) ✅
20. **E2E test extended** — 12 test cases covering driver detail, maintenance, reimbursements, defects, allocations, inspections ✅
21. **Driver list link fix** — Now links to /dashboard/drivers/[id] instead of /dashboard/staff/[id] ✅

### Next Session
8. **API route tenant isolation gaps** — ✅
   - Trip logs GET: added tenant filter via trips join
   - Reimbursements POST: added auth session + FUEL_MANAGE permission + tenant isolation via vehicles join
   - Trips close POST: added tenant isolation + status validation (only `return_inspection`/`closure_review`)
9. **Inspection→trip transitions** — ✅
   - Departure inspection (passing) → trip status `in_progress`, `startedAt` set
   - Return inspection (passing) → trip status `closure_review`, `returnedAt` set
   - Only transitions when `overallPass` is true (failed inspections don't advance)
10. **Pre-existing lint fixes** — ✅ drivers + settings pages

### Session 8 ✅
22. **Vehicle Compliance Tracking** — Compliance API (`GET /api/fleet/compliance`) returns vehicles with licence/roadworthy/insurance expiry status, upcoming expiry alerts, summary stats. Compliance page shows color-coded vehicle cards, expiry timeline, search/filter. ✅
23. **Live Fleet Map with GPS** — Fleet Map API (`GET /api/fleet/map`) returns vehicle locations by office with status markers. Interactive map page using Leaflet npm package with circle markers, popups, status filter, info sidebar. Note: live GPS is out of scope for v1 — positions are office-based static locations. ✅
24. **OCR Expense Capture & Reporting** — Expenses API (`GET /api/fleet/expenses`) returns fuel costs, receipt coverage, anomalies, reimbursements. Expense page with receipt scan (Tesseract.js OCR), period selector, missing receipt alerts, transaction list. ✅
25. **Driver Self-Service Portal** — `/dashboard/driver-self-service` page with profile card, licence management (view/expiry status), active trips, trip history, notifications, quick actions (inspections, logs, fuel). `/api/drivers/me` endpoint queries driver profile by session user. ✅
26. **Predictive Maintenance AI** — Rules-based prediction engine (`src/lib/predictive-maintenance.ts`) with 4 factors: odometer interval, time interval, compliance risk, usage intensity. Weighted urgency scoring (0–100). Predictive maintenance API + dashboard page with urgency bars, factor grids, recommendations, compliance flags. ✅
27. **Sidebar updates** — Added Fleet Map, Compliance, Predictive Maint., Expenses, Driver Self-Service links. ✅
28. **Deployed** — Commit pushed to origin/master. ✅

### Session 9 ✅
29. **Document detail tenant isolation** — Added `getServerSession()` + tenant filter to document detail page. ✅
30. **Active trips dashboard widget** — Active trips section on main dashboard showing in_progress/return_due trips with vehicle info, driver name, status badges, links to trip detail. ✅
31. **Native share / WhatsApp share** — `ShareActions` component using Web Share API with clipboard fallback, wired into document detail page action bar. ✅
32. **Cross-tenant security tests** — 13 Vitest test cases covering all core entities (vehicles, requests, trips, employees, defects, fuel, audits, inspections, allocations, notifications, documents, join-chain verification, structural test). Tenant IDs resolved from database via beforeAll hook. ✅
33. **Document detail security gap closed** — Documents page now enforces tenant isolation at the DB query level. ✅

### Next Session
- End-to-end Playwright test suite for regional trip workflow
- Permission matrix testing
- Production hardening: error boundaries, monitoring

---

## How to Use This Roadmap

1. At the start of each session, read this file
2. Find the highest-priority incomplete item in the earliest incomplete phase
3. Verify the status in the actual codebase (don't trust the status blindly)
4. Implement it end-to-end
5. Update the status in this file
6. Update PROJECT-STATUS.md
7. Continue to the next item
