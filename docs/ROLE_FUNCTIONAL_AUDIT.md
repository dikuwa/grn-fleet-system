# GRN Fleet Management — Multi-Role Functional Audit

**Audit date:** 27 July 2026

**Environment:** isolated local PostgreSQL 15 database and local production build

**Production data:** not seeded, reset, or mutated

**Application revision:** working tree at the end of this audit

## 1. Executive summary

| Measure | Result |
|---|---:|
| Seeded accounts authenticated | 13/13 |
| Dashboard pages inventoried and permission-reviewed | 76/76 |
| API route handlers inventoried and permission-reviewed | 96/96 |
| Automated cases passing | 234 (82 unit, 42 integration, 110 browser) |
| Browser cases discovered | 138 |
| Browser cases skipped by existing conditional/superseded coverage | 28 |
| Product/test-harness defects found | 11 |
| Defects fixed and retested | 11 |
| Critical or high defects remaining | 0 |

The regional workflow passes from request creation through separate-person approval,
allocation, release, authorisation, driver acknowledgement, issue, departure inspection,
trip execution, fuel/log capture, return inspection, maintenance escalation, and closure.
The national routing path passes with Director release and Chief Regional Officer final
authorisation. Rejection, return/resubmission, withdrawal, duplicate-action protection,
vehicle/driver conflicts, cross-tenant access, and auditor write denial are covered.

The Tenant Administrator can update and remove a private profile image; load, validate,
save, and reload organisation settings; and upload, replace, retrieve, and remove a
private tenant logo. The logo and avatar were verified after reload and then removed.
Settings and branding mutations create audit events. Employee creation, role assignment
including Driver, lifecycle status changes, and acting appointments are covered by the
existing employee lifecycle and permission suites.

**Readiness:** suitable for deployment review. The production database still requires
the normal reviewed migration/deployment process. External email/SMS delivery and object
storage availability remain environment-dependent.

## 2. Test environment and method

- Created a disposable local PostgreSQL database, applied every Drizzle migration, and
  ran the idempotent seed. The seed produced two isolation tenants, 13 login accounts,
  14 linked employees, 15 system roles, five fleet vehicles, two verified driver
  profiles/licences, and regional/national workflow definitions.
- Used the production Next.js build for final browser and integration checks.
- Used Playwright for all-role login, responsive shell, route/action, permission,
  uploads, offline, reporting, and workflow coverage.
- Used an interactive browser session for Tenant Administrator dashboard, profile,
  avatar, settings, logo persistence/removal, accessibility names, console, and network
  behavior.
- Verified server-side state through API responses and direct local database assertions
  in the role-isolation workflow.
- Kept production read-only; no production record was created or altered.

Evidence is stored in `docs/qa-evidence/screenshots/`. The most relevant captures are:

- `tenant-admin-dashboard.png`
- `tenant-admin-profile.png`
- `tenant-admin-avatar-after-upload.png`
- `tenant-admin-settings.png`
- `tenant-admin-branding-logo-persisted.png`

## 3. Role-by-role result matrix

Route groups below map to the complete route inventory in section 4. “Denied” means both
navigation filtering and server/API enforcement were checked where a write or
cross-boundary action existed.

| # | Account / detected role | Routes and actions exercised | Boundaries and persistence | Desktop / mobile | Result |
|---:|---|---|---|---|---|
| 1 | `admin@kavangoeast.gov.na` — Tenant Administrator | Dashboard; profile/avatar upload, reload, replace/remove; settings validation/save/reload; private logo upload/download/remove; staff, users, roles, workflows, delegations, regions, offices, departments, reports, audit | Settings/logo audit rows written; tenant logo key scoped to tenant; platform APIs denied; employee/role/lifecycle integration coverage passed | Interactive desktop plus 390×844 shell; no overflow | Pass |
| 2 | `platform.admin@grnfleet.test` — Platform Super Administrator | Platform dashboard, tenant list/detail/onboarding, analytics and activity APIs; search/inspect tenant | Tenant operational routes not granted by platform role; tenant admin denied platform APIs; second-tenant isolation assertions passed | Desktop route checks and 390×844 shell | Pass |
| 3 | `transport.admin@kavangoeast.test` — Transport Administrator | Request review, allocation, driver/vehicle selection, trip creation/issue/close, fuel verification, fleet, inspections, reports | Vehicle and driver conflicts rejected; assignments persisted; closure gates enforced; completed safe vehicle released, blocking defect retained maintenance state | Desktop workflow plus mobile shell/routes | Pass |
| 4 | `requester@kavangoeast.test` — Requester / Programme Owner | Create/submit regional and national requests; people lookup; view own record; reject/resubmit/cancel branches | Other-tenant IDs hidden; supervisor assignment, request status, audit, and workflow instances persisted; settings mutations denied | Desktop workflow and requester/mobile coverage | Pass |
| 5 | `supervisor@kavangoeast.test` — Immediate Supervisor | Assigned approval list/detail; approve, reject, and return-for-correction flows | Decision actor/comment/time persisted; duplicate or completed-stage action rejected; progresses only to transport review | Desktop action flow and 390×844 shell | Pass |
| 6 | `release.officer@kavangoeast.test` — Control Administrative Officer | Regional release package and action | Release before allocation/driver is blocked; release history persisted; regional route advances to final authorisation only | Desktop action flow and 390×844 shell | Pass |
| 7 | `regional.authoriser@kavangoeast.test` — Deputy Director | Regional final authorisation and complete history review | Requires prior regional release and allocation; provisions Trip Authority; national authorisation denied | Desktop action flow and 390×844 shell | Pass |
| 8 | `national.release@kavangoeast.test` — Director | National release action and history | Regional-only actions and unrelated tenant data denied; advances to CRO final stage | Desktop action flow and 390×844 shell | Pass |
| 9 | `national.authoriser@kavangoeast.test` — Chief Regional Officer | National final authorisation | Requires prior Director release; Trip Authority provisioned; role has no accidental Driver permission merge | Desktop action flow and 390×844 shell | Pass |
| 10 | `driver@kavangoeast.test` — Assigned Driver | Assigned trip, acknowledgement, departure inspection, issue/start, daily log, fuel entry, return, offline draft surfaces | Only assigned trip is executable; unauthorised start blocked; monotonic odometers and idempotent sync enforced; vehicle becomes in-use then return-inspection | Driver mobile/self-service and 360/390 mobile checks | Pass |
| 11 | `inspector@kavangoeast.test` — Inspector | Inspection list/detail, departure/return forms, checklist, defects and photos | Mandatory items/acknowledgements enforced; critical failure creates blocking defect and maintenance event; completed return enables closure review | Desktop and mobile inspection controls | Pass |
| 12 | `maintenance@kavangoeast.test` — Maintenance Officer | Maintenance list/create/update, defects, fleet/inspection read surfaces | Maintenance vehicle cannot be allocated; blocking defect survives operational closure; safe completion can restore availability | Desktop routes and 390×844 shell | Pass |
| 13 | `auditor@kavangoeast.test` — Tenant Auditor | Audit search/filter/detail, reports and operational history | Creation, allocation, approval, release, authorisation, settings and closure writes denied server-side; cross-tenant records hidden | Desktop audit/report checks and 390×844 shell | Pass |

## 4. Route-permission-action matrix

### 4.1 Role abbreviations

`PA` Platform Administrator, `TA` Tenant Administrator, `TR` Transport Administrator,
`RQ` Requester, `SV` Supervisor, `RO` Regional Release Officer, `RA` Regional
Authoriser, `NR` National Release Officer, `NA` National Authoriser, `DR` Driver, `IN`
Inspector, `MO` Maintenance Officer, and `AU` Tenant Auditor.

Every route below requires an authenticated session unless described as public. The
dashboard layout uses `dashboardAccessRules`; pages and APIs then repeat permission and
tenant checks. Roles not listed in “allowed” are denied, except where a tenant has
explicitly configured an equivalent permission.

### 4.2 Dashboard pages (76)

| Route(s) | Page / permission | Allowed | Read and write actions / backing API | Database effect | Final |
|---|---|---|---|---|---|
| `/dashboard` | Role-aware dashboard / authenticated | All 13 | Metrics and alerts from scoped APIs | None on read | Pass |
| `/dashboard/profile` | Own profile / authenticated | All 13 | Profile edit, password and avatar via `/api/users/profile`, `/avatar`, `/upload-avatar`, `/change-password` | User/profile image key and audit metadata | Pass |
| `/dashboard/notifications`, `/dashboard/notifications/history` | Own notifications / authenticated | All tenant roles | Read/filter/mark read via `/api/notifications` | Own notification read state | Pass |
| `/dashboard/offline`, `/dashboard/sync-conflicts` | Offline drafts/conflicts / authenticated | All tenant roles | Local draft inspect, retry, discard and sync | IndexedDB then idempotent operational API writes | Pass |
| `/dashboard/platform`, `/dashboard/platform/tenants`, `/dashboard/platform/tenants/[id]`, `/dashboard/platform/onboard` | Platform administration / `platform:admin` | PA | Tenant list/detail/activity/onboard via `/api/platform/*` | Tenant setup/status; platform audit | Pass |
| `/dashboard/admin/users`, `/dashboard/admin/users/[id]`, `/dashboard/admin/roles`, `/dashboard/admin/workflows`, `/dashboard/admin/regions` | Tenant administration / `tenant:manage` | TA | User invite/edit, role assignment, workflow routing, region CRUD via admin/region APIs | Memberships, role assignments, workflow definitions, regions, audit | Pass |
| `/dashboard/settings` | Tenant settings / `tenant:manage` | TA | Validate/save settings and private logo via `/api/settings`, `/api/settings/logo` | Tenant/branding/preferences plus audit | Pass |
| `/dashboard/offices`, `/dashboard/departments` | Organisation structure / `tenant:manage` | TA | CRUD via `/api/offices`, `/api/departments` | Tenant-scoped organisation rows and audit | Pass |
| `/dashboard/staff`, `/dashboard/staff/new`, `/dashboard/staff/[id]`, `/dashboard/staff/import`, `/dashboard/staff/imports`, `/dashboard/staff/imports/[id]` | Staff / `staff:view/manage` | TA, TR, AU(read) | Search, create/edit, lifecycle, role/driver conversion, import via employee/admin/import APIs | Employee lifecycle retained; no historical hard-delete | Pass |
| `/dashboard/delegations` | Acting appointments / `staff:view` plus `delegation:manage` to write | TA, TR(read/write when granted), AU(read) | Create/date/end acting assignment via `/api/delegations` | Time-bounded role delegation and audit | Pass |
| `/dashboard/drivers`, `/dashboard/drivers/[id]` | Driver records / `staff:view` or `driver:manage` | TA, TR, DR(own API), AU(read) | Driver conversion, availability and licence history via `/api/drivers*` | Driver profile/licence/verification state | Pass |
| `/dashboard/programmes` | Programmes / `request:create/view` | RQ, TA, TR, SV, AU(read) | Programme read/create where granted via `/api/programmes` | Tenant programme rows | Pass |
| `/dashboard/requests`, `/dashboard/requests/new`, `/dashboard/requests/[id]` | Requests / `request:create/view` | RQ, TA, TR, SV, RO, RA, NR, NA, AU(read by scope) | Create/submit/view/edit/cancel/resubmit via transport-request/request APIs | Request, passengers, workflow, notification, audit rows | Pass |
| `/dashboard/approvals`, `/dashboard/approvals/[id]`, `/dashboard/approvals/[id]/action` | Assigned workflow / stage permission | SV, TR, RO, RA, NR, NA | Approve/reject/return/release/authorise via `/api/approvals/[id]/action` | Workflow action, request stage, notification, audit, authority | Pass |
| `/dashboard/allocations`, `/dashboard/allocations/new`, `/dashboard/allocations/[id]` | Allocation / `allocation:create/manage` | TR, TA when explicitly granted, AU(read history) | Recommend, create, assign/reassign driver/vehicle via `/api/allocations*`, availability API | Allocation version/history; vehicle and driver reservation | Pass |
| `/dashboard/trips`, `/dashboard/trips/[id]`, `/dashboard/trips/[id]/authority`, `/dashboard/trips/active`, `/dashboard/trips/closure-review` | Trips / `trip:view/manage` | TR, DR(assigned), IN(read), MO(read), AU(read), approval roles(read package) | Acknowledge, issue, start, log, return, authority/PDF, close via `/api/trips*` | Trip state, immutable odometers, authority, vehicle state, audit | Pass |
| `/dashboard/driver-mobile`, `/dashboard/driver-self-service`, `/dashboard/logs` | Driver operations / `driver-log:view` (or `trip:manage` for logs) | DR, TR, TA when granted, AU(read) | Assigned trip, offline logs/fuel, execution actions | Trip log/fuel/progress rows | Pass |
| `/dashboard/fuel`, `/dashboard/fuel/new`, `/dashboard/fuel/[id]` | Fuel / `fuel:view/manage` or `driver-fuel:create` | DR(create assigned), TR(verify), TA/AU(read when granted), MO(read) | Create, receipt, verify/reject via `/api/fuel`, `/api/fuel/receipts` | Tenant-scoped fuel transaction, review actor/time/status, audit | Pass |
| `/dashboard/reimbursements`, `/dashboard/reimbursements/[id]` | Reimbursements / `fuel:view/manage` | TR, TA/AU read when granted | Read and workflow actions via `/api/reimbursements*` | Reimbursement state and audit | Pass |
| `/dashboard/fleet`, `/dashboard/fleet/new`, `/dashboard/fleet/[id]`, `/dashboard/fleet/[id]/edit`, `/dashboard/fleet/import`, `/dashboard/fleet/imports`, `/dashboard/fleet/imports/[id]`, `/dashboard/fleet/map`, `/dashboard/fleet/compliance`, `/dashboard/fleet/expenses`, `/dashboard/fleet/predictive-maintenance` | Fleet / `vehicle:view/manage` | TR, MO(read/manage maintenance), TA/AU read when granted | CRUD/import/transfer/decommission/map/compliance/expenses via `/api/fleet*` | Vehicle, document, import, transfer and audit rows | Pass |
| `/dashboard/fleet/defects` | Defects / `maintenance:view/manage` | MO, TR, IN(read created defects), AU(read) | Resolve/follow up via `/api/defects/[id]/resolve` | Defect and vehicle safety state | Pass |
| `/dashboard/maintenance`, `/dashboard/maintenance/new` | Maintenance / `maintenance:view/manage` | MO, TR, AU(read) | Create/update/complete via `/api/maintenance` | Maintenance history and vehicle availability | Pass |
| `/dashboard/inspections`, `/dashboard/inspections/new`, `/dashboard/inspections/[id]`, `/dashboard/inspections/departure`, `/dashboard/inspections/return`, `/dashboard/inspections/templates` | Inspections / `inspection:view/perform` | IN, RO where departure duty granted, TR(read), DR assigned acknowledgement, MO/AU(read) | Checklist, photos, defect creation, templates via inspection/upload APIs | Inspection/results/photos/defects/maintenance/trip stage | Pass |
| `/dashboard/expiry-alerts` | Expiry dashboard / `vehicle:view` or `staff:view` | TA, TR, MO, AU(read) | Licence/document/vehicle expiry read | None on read | Pass |
| `/dashboard/documents`, `/dashboard/documents/[id]`, `/dashboard/share-links` | Files/documents / `file:view` | TA, TR, AU and scoped operational roles | View, generate PDF, approve/share via document/file APIs | Generated document and share-link lifecycle | Pass |
| `/dashboard/reports` | Reports / `report:view` | TA, TR, AU and configured readers | Snapshot/report/export PDF via `/api/reports*` | None except generated export metadata | Pass |
| `/dashboard/audit` | Audit / `audit:read` | TA, AU, configured TR | Read/search/filter only via `/api/audit` | No mutation endpoint | Pass |

### 4.3 Protected API inventory (96 handlers)

| API family and concrete routes | Required enforcement | Roles/actions | Result |
|---|---|---|---|
| Auth: `/api/auth/[...all]`, `/api/auth/custom-sign-in` | Credentials, active user, active membership, session tenant | All accounts; invalid credentials/unauthenticated cases | Pass |
| Platform: `/api/platform/dashboard`, `/analytics`, `/onboard`, `/tenants`, `/tenants/[id]`, `/tenants/[id]/activity` | `platform:admin`; no tenant-role fallback | PA read/write; every tenant-only role denied | Pass |
| Tenant admin: `/api/admin/invites`, `/roles`, `/users`, `/users/[id]`, `/users/[id]/delegate`, `/users/reset-password`, `/workflows`; `/api/settings`, `/settings/logo`; `/api/regions`, `/offices`, `/offices/[id]`, `/departments`, `/departments/[id]`, `/delegations` | Tenant/manage or precise read/write permission; tenant predicates | TA manages; delegated readers cannot mutate | Pass |
| People: `/api/employees`, `/employees/[id]/lifecycle`, `/drivers`, `/drivers/me`, `/drivers/[id]/licences`, `/people-search`, `/users/invite`, `/users/profile`, `/users/avatar`, `/users/upload-avatar`, `/users/change-password` | Own-user or staff/driver permission; active tenant employee | Own profile plus scoped admin lifecycle/driver work | Pass |
| Requests/workflow: `/api/programmes`, `/transport-requests`, `/requests/[id]/cancel`, `/requests/[id]/resubmit`, `/approvals/[id]/action` | Owner/assigned stage and action-specific permission; optimistic state/idempotency | RQ, SV, TR, RO/RA/NR/NA | Pass |
| Allocation: `/api/allocations`, `/allocations/[id]/action`, `/allocations/[id]/driver`, `/vehicles/[id]/availability` | Allocation permission, tenant and overlap eligibility | TR; read-only roles denied writes | Pass |
| Trip: `/api/trips`, `/trips/[id]`, `/trips/create-from-allocation`, `/trips/[id]/acknowledge`, `/issue`, `/start`, `/operations`, `/return`, `/close`, `/check-return-due`, `/trips/[id]/authority/amendments`, `/authority/pdf`, `/trip-logs` | Trip permission plus assigned driver/stage/state gates and tenant | TR manages; DR assigned execution; audit readers read | Pass |
| Fleet: `/api/fleet`, `/fleet/[id]`, `/fleet/[id]/decommission`, `/fleet/[id]/transfer`, `/fleet/compliance`, `/fleet/expenses`, `/fleet/import`, `/fleet/map`, `/fleet/predictive-maintenance`, `/defects/[id]/resolve`, `/maintenance` | Vehicle/maintenance permission and tenant | TR/MO writes by responsibility | Pass |
| Inspections: `/api/inspections`, `/inspections/[id]`, `/inspection-templates`, `/inspection-templates/[id]` | Inspection view/perform/manage and tenant; mandatory template | IN/RO perform; TR/MO/AU scoped read | Pass |
| Fuel/reimbursement: `/api/fuel`, `/fuel/receipts`, `/reimbursements`, `/reimbursements/[id]`, `/reimbursements/[id]/action` | Assigned driver create or fuel-manage review; tenant | DR creates; TR verifies/rejects | Pass |
| Documents/uploads: `/api/documents/[id]/action`, `/documents/[id]/pdf`, `/files`, `/upload`, `/import`, `/share-links` | File/entity permission, safe object key and tenant prefix | Scoped operational roles | Pass |
| Reports/audit/search: `/api/reports`, `/reports/enhanced`, `/reports/employee-lifecycle`, `/audit`, `/search`, `/reference`, `/routes/calculate`, `/notifications` | Read permission, tenant query, own notification state | TA/TR/AU and configured readers | Pass |
| Public request intake: `/api/public/requests/[tenantSlug]/otp`, `/submit`, `/track/[id]`, `/verify` | Tenant slug, OTP/tracking secret, validation and rate controls | Public constrained intake only | Pass |
| Infrastructure: `/api/inngest`, `/api/sentry-example-api` | Provider/example route controls; not a tenant business mutation | Operational infrastructure | Code-reviewed; build pass |

## 5. End-to-end workflow results

### Regional

1. Requester created a current-dated regional request; fields, requester employee,
   passengers, status, audit, workflow instance, and supervisor assignment persisted.
2. Supervisor approved as the assigned actor; duplicate/completed-stage decisions were
   blocked.
3. Transport Administrator allocated an available vehicle and eligible verified driver;
   database overlap rules protect vehicle and driver double-booking.
4. Regional release actor completed administrative release after allocation.
5. Regional Authoriser completed final authorisation. The fix now provisions the
   canonical Trip Authority and exposes the trip to the assigned driver.
6. Driver acknowledged, completed departure requirements, was issued the vehicle,
   started the trip, and added idempotent daily-log and fuel records.
7. Driver returned with a monotonic odometer.
8. Inspector completed return inspection. A blocking defect path created maintenance
   state and a non-blocking path made the trip closure-eligible.
9. Transport Administrator closed the trip. Safe vehicles return to available;
   vehicles with blocking defects remain in maintenance.

**Result:** pass with direct API/database state assertions.

### National

The second scenario passed Requester → Supervisor → Transport review/allocation →
Director national release → Chief Regional Officer final authorisation → assigned
driver availability. Regional authorisation credentials were rejected for the national
stage. Rejection, resubmission, and cancellation paths were also exercised.

**Result:** pass. The full execution/return mechanics use the same tested trip state
machine as the regional workflow; the national-specific routing and actor separation
were independently asserted.

## 6. Defect register

| ID | Role / route | Severity | Reproduction and root cause | Fix and changed files | Retest |
|---|---|---|---|---|---|
| D-01 | Staff/admin permissions | High | Employee lifecycle, delegation, licence verification and secure-request assistance were absent from the Staff permission group | Added four canonical permissions in `src/lib/permissions.ts` | 42/42 integration pass |
| D-02 | Regional/national authorisation | Critical | Final approval changed request stage but did not provision the canonical Trip Authority; driver acknowledgement did not update authority state | Provision/update authority in `src/lib/workflow-engine.ts` | Multi-role regional/national pass |
| D-03 | Driver fuel / `/dashboard/fuel/[id]` | High | Driver fuel records had no review mutation/UI; detail lookup was not tenant-filtered | Added tenant-scoped PATCH verify/reject and review actions; scoped detail query in fuel route/page/new component | Workflow and direct denial pass |
| D-04 | Closure / `/api/trips/[id]/close` | High | A completed failed return inspection blocked closure entirely, even when the intended outcome was operational closure with the vehicle retained in maintenance | Accept completed or failed return inspection while preserving blocking maintenance state | Regional closure/maintenance pass |
| D-05 | Tenant branding / `/dashboard/settings` | High | No functional tenant-logo endpoint or persistent upload/remove controls | Added validated Sharp/WebP private storage route, replacement cleanup, UI preview/loading/error/removal, tenant prefix and audit | Interactive reload plus 3/3 settings E2E pass |
| D-06 | Tenant settings | High | Settings mutations lacked strong validation and an audit event; several branding controls lacked accessible names | Added name/hex/email validation, settings audit, accessible select/text/file controls and duplicate-submit state | API/UI persistence and accessibility pass |
| D-07 | Reports snapshot | Medium | Sidebar metric polling requested `type=snapshot`, which the reports API rejected with 400 | Added permission-safe snapshot report type in `src/app/api/reports/route.ts` | Dashboard network check and full E2E pass |
| D-08 | Dashboard hydration | Medium | Offline status read browser state during initial render/effect, producing hydration or lint instability | Switched online state to `useSyncExternalStore` with a stable server snapshot | Mobile/offline E2E, lint and build pass |
| D-09 | Navigation | Low | Reports and Enhanced Analytics produced duplicate route/key entries | Removed duplicate sidebar item | All-role shell pass |
| D-10 | Local QA database adapter | Medium | Neon HTTP adapter cannot communicate with a standard local PostgreSQL URL, blocking safe isolated integration/E2E validation | Select `postgres-js` only for localhost and preserve Neon HTTP for hosted URLs in `src/db/index.ts` | Migrate, seed, integration and E2E pass |
| D-11 | Trip detail malformed ID | Low | Form-control smoke passed `tripId=test`; the trip API sent it to a UUID column and logged a PostgreSQL exception | Early UUID validation returns safe 400 in `src/app/api/trips/[id]/route.ts` | Production rebuild and focused 2/2 browser pass; clean server log |

The originally reported profile-avatar problem was not reproducible in the final
baseline: supported image upload, authenticated retrieval, immediate header/profile
refresh, persistence after reload, replacement, and removal all passed. No new profile
code was required in this audit.

## 7. Responsive, theme, and accessibility results

| Viewport / surface | Coverage | Result |
|---|---|---|
| 1440×900 desktop | Interactive Tenant Administrator plus workflow/report/fleet/inspection suites | Pass |
| 1024×768 tablet | Shared responsive dashboard/public layouts | Pass |
| 768×1024 portrait | Shared tablet layout and route surfaces | Pass |
| 390×844 mobile | Every seeded role shell; dashboard, requests, fleet, trips, allocations, inspections, reports, fuel, maintenance, driver surfaces | Pass |
| 360×800 mobile | Public/login/privacy and driver/form touch/overflow checks | Pass |
| Light/dark/system | Public pages and authenticated dashboard/trips | Pass |

Mobile navigation opens/closes, scrolls, exposes lower items, and does not create
horizontal document overflow. Form controls meet the tested touch-size checks. The
offline status uses a server-safe initial snapshot and responds to browser online/offline
events without hydration errors. Settings file, colour, organisation and save controls
have accessible names.

## 8. Automated coverage and final quality gates

### Added

- `src/e2e/tenant-admin-settings.spec.ts`
  - Settings load, validation, mutation and reload.
  - Accessible settings UI.
  - Private tenant-logo upload/download/removal.
  - Requester denial for settings and logo writes.

### Updated

- `src/e2e/role-isolation-workflow.spec.ts` — current dates, required return/departure
  payloads, fuel review, closed-state and regional/national lifecycle assertions.
- `src/e2e/regional-trip-workflow.spec.ts` — correct stage-specific account.

### Final commands

| Command | Result |
|---|---|
| `pnpm typecheck` | Pass, 0 errors |
| `pnpm lint` | Pass, 0 errors; 158 existing warnings |
| `pnpm test` | 82/82 pass |
| `pnpm test:integration` (with local server) | 42/42 pass |
| `pnpm build` | Pass; 123 static/data routes generated |
| `pnpm exec playwright test --workers=1` | 110 pass, 28 skipped, 0 fail |
| Focused post-fix photo form regression | 2/2 pass |

The 28 skipped browser cases are existing conditionally unavailable-data checks and
scenarios marked as superseded by `role-isolation-workflow.spec.ts`; no test or lint rule
was disabled to obtain this result.

## 9. Remaining risks

- Production was intentionally not mutated. Deployment, migration, secrets, object
  storage, and provider health must be verified in the target deployment window.
- Email/SMS delivery cannot be guaranteed without live provider credentials; in-app
  notification creation and delivery records passed.
- The repository has 158 non-blocking lint warnings, primarily unused imports, hook
  dependency advisories, and intentional inspection/avatar `<img>` previews. There are
  no lint errors.
- Some legacy browser scenarios are superseded or data-conditional. The authoritative
  regional/national and isolation test is active and passing, but consolidating the old
  specs would reduce suite ambiguity.
- Browser storage capacity and offline behavior vary by device; tested IndexedDB
  creation, status, retry/discard surfaces, and idempotent server sync passed.

## 10. Test data and cleanup

All mutable QA data lives in the disposable local database `grn_fleet_qa` on the
temporary local PostgreSQL cluster. It includes records created by:

- Full regional workflow and role-isolation workflow.
- National routing, rejection, resubmission, and cancellation scenarios.
- Fuel, maintenance, audit, notification, PDF, route-calculation, inspection/photo,
  offline, return-due, and tenant-settings scenarios.
- A second tenant and vehicle used solely for isolation assertions.

Uploaded Tenant Administrator avatar and logo objects were removed through their
supported UI/API cleanup actions after persistence was verified. No production cleanup
is required because production data was not changed.
