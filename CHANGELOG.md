# Changelog

## 2026-07-15 — Phase 11: Documents, PWA, API routes and gap fixes

### Added

**API Routes (real DB-backed)**

- `POST /api/fuel` — Creates fuel transaction with vehicle GRN→UUID resolution, auto-creates reimbursement for personal payment method, employee number lookup for claimant
- `POST /api/reimbursements` — Creates reimbursement claim linked to fuel transaction, employee lookup by employee number
- `POST /api/approvals/[id]/action` — Records workflow action (approve/reject/return), advances/cancels workflow instance, validates current step and status, properly filters by currentStepOrder

**Phase 11 — Documents**

**Documents List Page**
- DB-backed server component with search (document type), type dropdown (transport_request, trip_authority, etc.), status filter (draft/issued/superseded), pagination
- Summary cards (total, issued, drafts, superseded counts)
- Document rows with type icon, version, status badge, creation date
- Proper error boundary: `isDbConnected()` check + try/catch fallback (eslint-disabled for this server component pattern)

**Document Detail Page**
- Status card with icon/color based on status (draft/issued/superseded)
- A4-format document preview with tenant header, snapshot data rendering
- Document metadata panel (type, version, template, status, redaction profile, hash, creator, timestamp)
- Secure sharing section with active share links display (expiry date, view count, revoke action)
- Version history card for superseded documents

**PWA (Progressive Web App)**

- `public/manifest.json` — Full manifest with app name, icons (SVG), shortcuts (Dashboard, Requests, Trips, Fuel), standalone display, brand colors
- `public/sw.js` — Service worker with network-first strategy for API/data, cache-first for static assets (Next.js chunks, icons, manifest), offline fallback responses, stale-while-revalidate for navigations
- `src/components/layout/service-worker-registration.tsx` — Client component registering SW in production
- Root layout update — `manifest`, `appleWebApp`, `mobile-web-app-capable` metadata; `<link rel="manifest">`, PWA meta tags, ServiceWorkerRegistration

### Fixed

- **Bug: `/api/approvals/[id]/action`** — Current step query now correctly filters by `currentStepOrder` using `and()` instead of just ordering by `stepOrder` and getting the first result
- **Bug: `/api/fuel`** — Now accepts `vehicleGrn` (GRN number string) with vehicle UUID lookup; `claimantEmployeeId` in reimbursement auto-creation uses proper employee number lookup; dynamic `import()` replaced with static import
- **Bug: Form sending UUID without lookup** — Fuel new entry form sends `vehicleGrn` (string) not raw UUID
- **Bug: `sw.js` TypeScript annotations** — Rewritten as plain JavaScript (no `/// <reference>`, no `ExtendableEvent`/`FetchEvent` type annotations, `var`/`function` syntax)
- **Bug: `manifest.json` icon type mismatch** — Changed from `.png` with `image/png` to `.svg` with `image/svg+xml`
- **Lint cleanup** — Unused imports removed from documents page (`CardHeader`, `CardTitle`, `XCircle`, `Plus`, `asc`); false positive `react-hooks/error-boundaries` disabled for server component pattern
- **Sidebar** — Documents icon changed to `FileSpreadsheet` with proper import

### Known Gaps

- Fuel/approvals form submissions send hardcoded `userId: 'system'` and `tenantId: '000000000001'` — needs real auth session
- Fuel form `employeeNumber` is empty string — personal reimbursement auto-creation won't find a real employee
- Document generation (snapshot creation) is not yet wired to any trip/request lifecycle events
- Share link creation/revocation UI exists but no real token hashing or verification page
- PWA offline draft storage (Dexie/IndexedDB) not yet implemented
- Service worker only registers in production mode

## 2026-07-15 — Phase 12: Reporting, analytics, audit and settings pages

### Added

**Phase 12 — Reports & Analytics**

- **Reports page (`/dashboard/reports`)** — Comprehensive KPI dashboard with 6 report types (Fuel Consumption, Fleet Utilisation, Trip Summary, Maintenance, Transport Requests, Approvals)
  - Fuel report: monthly consumption bar charts, top 10 consumers, reimbursement summary, unit cost analytics
  - Fleet report: status distribution visualisation, vehicle utilisation rates
  - Trip report: monthly volume trends, scope breakdown (regional vs national), distance analytics
  - Maintenance report: event log with status badges, cost tracking
  - Requests/Approvals reports: status breakdown bars, queue overview tables
  - Time range filters (7d/30d/quarter/year), export buttons (CSV/Print)
  - All data displayed with mock data ready for real API integration

- **Audit Log page (`/dashboard/audit`)** — Immutable event trail with cryptographic hash-chain verification display
  - Filterable by event type (requests, approvals, allocations, trips, fuel, maintenance, inspections, fleet, staff, auth)
  - Free-text search across actions, actors, entities, and details
  - Timeline view with event-type colour coding and severity badges (info/warning/critical)
  - Hash chain integrity panel showing verification status
  - Pagination with "Load More"

- **Notifications page (`/dashboard/notifications`)** — Full notification centre
  - Type filters (Action Required, Awareness, Reminder, Escalation, Outcome)
  - Read/Unread/All toggle
  - Unread count badge, priority indicators
  - Entity type icons, action links to relevant pages
  - "Mark All Read" functionality
  - Empty states for different filter scenarios

- **Settings page (`/dashboard/settings`)** — Multi-tab configuration centre
  - General: tenant info, contact details, timezone, locale, regional config (trip scope, fuel card, km thresholds)
  - Notifications: delivery channels (in-app, email, SMS), notification type toggles, quiet hours
  - Security: password change form, active sessions list with revoke, audit log access badges
  - Branding: logo upload placeholder, primary/accent colour pickers, document footer, email sender config

- **Tabs UI component (`src/components/ui/tabs.tsx`)** — Radix-based accessible tabs for use across pages

**API Routes (real DB-backed)**

- `GET /api/reports` — Multi-type report data aggregation
  - `?type=fuel` — Total litres, cost, avg cost/litre, top 10 consumers, pending reimbursements
  - `?type=fleet` — Status distribution counts, total vehicles
  - `?type=trips` — Trip stats grouped by status
  - `?type=requests` — Request stats grouped by status
  - `?type=maintenance` — Total events, total cost, grouped by service type
  - `?type=dashboard` — Aggregate summary (active requests, active trips, open defects)
  - All endpoints support `?period=7d|30d|90d|1y` and `?tenantId=` filtering

- `GET /api/audit` — Searchable audit events with pagination, event type filter, free-text search, hash chain head
- `GET /api/notifications` — List notifications by user, type filter, unread-only mode
- `PATCH /api/notifications` — Mark single/all read, update notification preferences

### Known Gaps (remains)

- All API routes use hardcoded `userId: 'system'` and `tenantId` — requires auth session wiring
- Reports/Audit pages display mock data when DB is not connected; API routes provide real data paths
- Document generation (snapshot creation) not yet wired to trip/request lifecycle events
- Share link creation/revocation UI exists but no real token hashing or verification page
- PWA offline draft storage (Dexie/IndexedDB) not implemented
- Service worker only registers in production mode
- No email/in-app notification on workflow actions
- No tenant isolation on queries (requires auth session)
- No real SMS provider integration
- Testing not yet executed (need DB credentials)

### Commands verified

- `pnpm lint` — passes (0 errors, 0 warnings)
- `pnpm build` — passes (0 errors)
