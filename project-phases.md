# Project Phases — Continuous Auto-Build

Each phase has an internal quality gate. The coding agent must not ask the owner for routine approval; pass the tests and continue.

## Phase 0 — Repository and verified foundation

**Objective:** Create a clean, reproducible project.

**Tasks**
- Initialise Git, pnpm and current stable Next.js TypeScript project.
- Add formatting, linting, strict TypeScript, Vitest and Playwright.
- Create environment validation.
- Add CI for lint, type-check, tests and build.
- Add package docs and record selected versions.
- Fetch/verify VibeKit references and component registry.

**Dependencies:** None.  
**Affected areas:** Root configuration and docs.  
**Migration:** None.  
**Risks:** Version incompatibility or unverified registry install.  
**Tests:** Clean install, lint, type-check, sample test, production build.  
**Completion:** CI passes from a fresh checkout.  
**Gate:** Automated.  
**Rollback:** Revert foundation commit.

## Phase 1 — Design system and application shell

**Objective:** Implement approved tokens, layout and responsive navigation.

**Tasks**
- Onest font and semantic tokens.
- Marketing and dashboard route groups.
- Sidebar, top bar, page header, breadcrumbs, mobile drawer.
- Buttons, forms, status badges, cards, tables, dialogs, toasts and states.
- Story/demo page for component verification.

**Dependencies:** Phase 0.  
**Tests:** Visual/accessibility smoke tests, responsive Playwright snapshots.  
**Completion:** Shell works at mobile, tablet and desktop widths.  
**Gate:** Automated.  
**Rollback:** Revert UI shell commit.

## Phase 2 — Database, authentication, tenancy and RBAC

**Objective:** Establish secure data boundaries.

**Tasks**
- Neon/Drizzle setup and migration commands.
- Better Auth password flow with no public sign-up.
- Users, tenants, memberships, roles, permissions, acting assignments.
- Tenant resolver and RLS policies.
- Platform and tenant admin areas.
- Temporary password and first-login change.

**Dependencies:** Phase 1.  
**Migration:** Initial core schema.  
**Risks:** Tenant leakage and auth misconfiguration.  
**Tests:** Cross-tenant denial, capability matrix, session revocation, first-login change.  
**Completion:** Two test tenants cannot access each other.  
**Gate:** Security tests mandatory.  
**Rollback:** Drop development schema only; never production data.

## Phase 3 — Offices, departments, staff and imports

**Objective:** Build employee directory and controlled bulk imports.

**Tasks**
- Offices, departments, employees and driver profiles.
- Staff versus user-account separation.
- CSV/XLSX upload, mapping, preview, duplicate detection and import history.
- Licence/document management and expiry status.
- Kavango East pilot seed structure.

**Dependencies:** Phase 2.  
**Migration:** People/import tables.  
**Tests:** Malformed rows, duplicates, permission denial, no automatic account creation.  
**Completion:** Import template and review workflow function end-to-end.  
**Gate:** Automated.  
**Rollback:** Import batch rollback before commit; post-commit correction through revision tools.

## Phase 4 — Fleet, defects and maintenance history

**Objective:** Establish reliable vehicle availability.

**Tasks**
- Vehicle categories and vehicle master data.
- Office assignment, documents, photos and odometer history.
- Defects, service reminders, maintenance events, downtime and write-off.
- Availability query and calendar.

**Dependencies:** Phase 2 and office data.  
**Migration:** Fleet/maintenance tables.  
**Tests:** Expired/defective/out-of-service vehicle blocking.  
**Completion:** Availability reflects all blockers.  
**Gate:** Automated.  
**Rollback:** Revert feature; preserve records.

## Phase 5 — Transport request and route calculation

**Objective:** Create the requester experience.

**Tasks**
- Multi-step request wizard and drafts.
- Programme activity, passengers, drivers and attachments.
- Google Places and Routes integration.
- Additional kilometres and manual override reason.
- Deterministic vehicle-category recommendation.
- Request signature acknowledgement.

**Dependencies:** Phases 3–4.  
**Migration:** Request, route and participant tables.  
**Risks:** Maps billing/failure and date/route errors.  
**Tests:** Regional/national classification, distance snapshot, map failure fallback, unsuitable driver.  
**Completion:** Requester can submit a valid request.  
**Gate:** Automated.  
**Rollback:** Disable route integration behind feature flag; preserve drafts.

## Phase 6 — Workflow engine, approvals and notifications

**Objective:** Automate staged responsibility.

**Tasks**
- Versioned workflow definitions and instances.
- Regional and national default definitions.
- Supervisor approval/rejection/comment.
- Awareness versus action notifications.
- Reminder/escalation jobs and quiet hours.
- Acting-role evidence and separation-of-duties rules.
- Emergency override.

**Dependencies:** Phase 5.  
**Migration:** Workflow, action, notification and override tables.  
**Tests:** Every valid/invalid transition, self-approval, release/authoriser separation, job idempotency.  
**Completion:** Approval inbox and timelines work for both scopes.  
**Gate:** Full workflow test suite.  
**Rollback:** Workflow definitions are versioned; do not mutate active instances.

## Phase 7 — Allocation and trip authority

**Objective:** Allocate exact vehicles and prepare authority documents.

**Tasks**
- Eligible vehicle list and recommendation panel.
- Provisional booking and overlap lock.
- Driver confirmation and licence validation.
- Trip-authority data entry/prefill.
- Vehicle change and reauthorisation rules.

**Dependencies:** Phases 4–6.  
**Migration:** Allocation and trip-authority tables.  
**Tests:** Concurrency allocation conflict, expired licence, post-authorisation replacement.  
**Completion:** Transport Administrator can move approved requests to release stage.  
**Gate:** Transaction/concurrency tests.  
**Rollback:** Cancel allocation safely and release reservation.

## Phase 8 — Inspections, administrative release and physical issue

**Objective:** Prevent unsafe or unauthorised departure.

**Tasks**
- Departure and return inspection checklist templates.
- Photos, odometer, fuel and co-signing.
- Regional Control Administrative Officer release.
- National Director release.
- Final authorisation and driver acknowledgement.
- Physical issue record for keys/fuel card/vehicle.

**Dependencies:** Phase 7.  
**Migration:** Inspection, release and issue tables.  
**Tests:** Block physical issue before all prerequisites; changed condition; missing photos.  
**Completion:** Vehicle can be issued only through the correct approved route.  
**Gate:** End-to-end security test.  
**Rollback:** Revoke issue only with audit event and return process.

## Phase 9 — Driver PWA and daily logsheet

**Objective:** Provide a reliable mobile trip experience.

**Tasks**
- Installable PWA and offline shell.
- Driver trip card and daily logs.
- Dexie draft storage and sync queue.
- Odometer/time/location validation.
- Conflict resolution and sync status.

**Dependencies:** Phase 8.  
**Migration:** Trip/log tables and sync IDs.  
**Tests:** Offline draft, repeated sync idempotency, stale conflict, tenant/user mismatch.  
**Completion:** Driver can capture daily logs offline and submit online.  
**Gate:** Browser offline E2E.  
**Rollback:** Disable offline feature while retaining online form.

## Phase 10 — Fuel, reimbursements, return and closure

**Objective:** Complete the operational trip lifecycle.

**Tasks**
- Fuel entries and receipt uploads.
- Government card, cash and personal reimbursement.
- Verification flags and duplicate checks.
- Return inspection and variance calculations.
- Closure checklist and Transport Administrator closure.

**Dependencies:** Phases 8–9.  
**Migration:** Fuel, reimbursement and closure tables.  
**Tests:** Invalid odometer, duplicate reference, transaction outside trip, missing receipt, closure blockers.  
**Completion:** Complete trip closes and vehicle returns to availability.  
**Gate:** Full trip E2E.  
**Rollback:** Reopen only through authorised audited action.

## Phase 11 — PDFs, document versions and secure sharing

**Objective:** Replace paper outputs with controlled evidence.

**Tasks**
- React PDF templates for all required documents.
- Tenant branding and template versions.
- Document snapshot/version/hash.
- Full-page dashboard preview.
- Expiring/revocable hashed share links.
- Redacted external views, copy, native share, WhatsApp open, email and print.

**Dependencies:** Core workflows.  
**Migration:** Documents and share-link tables.  
**Tests:** PDF content, page overflow, expiry, revocation, redaction, token hashing.  
**Completion:** Documents match data and cannot leak sensitive fields.  
**Gate:** PDF and security suite.  
**Rollback:** Disable external sharing; internal documents remain.

## Phase 12 — Reports and audit integrity

**Objective:** Provide management oversight.

**Tasks**
- KPI dashboard and report filters.
- CSV, Excel, PDF and print exports.
- Permanent append-only audit UI.
- Hash-chain verification job.
- Approval turnaround, utilisation, fuel and maintenance reports.

**Dependencies:** All operational modules.  
**Migration:** Audit chain fields and report jobs if needed.  
**Tests:** Aggregate correctness, permission boundaries, large export, chain verification.  
**Completion:** Approved reports reconcile with source records.  
**Gate:** Data reconciliation tests.  
**Rollback:** Disable a faulty report; preserve source data.

## Phase 13 — Public website and tenant onboarding

**Objective:** Present a credible pilot and onboard future tenants.

**Tasks**
- Marketing pages and SEO.
- Demo/contact form with spam protection.
- Platform tenant creation wizard.
- Branding, offices, workflow defaults and numbering configuration.
- No unsupported national-adoption claims.

**Dependencies:** Design system and platform tenancy.  
**Tests:** SEO metadata, accessibility, form abuse protection and onboarding isolation.  
**Completion:** Pilot can be demonstrated and a second tenant created.  
**Gate:** Automated and content review against approved copy.  
**Rollback:** Marketing deployment independent from internal routes where practical.

## Phase 14 — Hardening, migration rehearsal and deployment

**Objective:** Ship safely.

**Tasks**
- Complete `pre-deployment.md`.
- Dependency/security scan.
- Performance and accessibility audit.
- Backup/restore rehearsal.
- Staging user acceptance scripts.
- Production env, domain, email and monitoring.
- Run production migration and smoke tests.
- Final handover.

**Dependencies:** All phases.  
**Tests:** Full regression, E2E, load smoke, restore test and production smoke.  
**Completion:** All critical issues resolved and build deployed.  
**Gate:** No unresolved critical/high security defects.  
**Rollback:** Documented deployment rollback and database restore procedure.
