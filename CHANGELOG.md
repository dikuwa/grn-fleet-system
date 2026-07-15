# Changelog

## 2026-07-14 — Phase 6: Vehicle allocation, trips, inspections and known gap fixes

### Added

**Trip List Page**
- DB-backed server component with search, status filters, pagination
- Summary cards (total, active, completed, cancelled)
- Status badges using STATUS_VARIANTS
- Requester info via employees join on transportRequests
- Proper error boundary: `isDbConnected()` check + try/catch fallback
- Pagination with URL search params

**Trip Detail Page**
- Trip summary card with full details (GRN, request reference, vehicle, requester, purpose, dates)
- Trip statistics section (total km, fuel litres, fuel cost)
- Timeline component with lucide icons for each phase (requested, allocated, departed, returned, closed)
- Log Entries table with driver, dates, origin/destination, distance, remarks
- Fuel Transactions table with date, litres, cost, station, receipt status
- Inspections card linked from vehicle detail
- Proper error boundary: `isDbConnected()` check + try/catch fallback

**CSV Import API Route**
- `POST /api/import` endpoint accepts JSON payload with rows and columns
- Creates importBatches and importRows records in database
- Handles duplicate employee detection by employee number
- Updates existing employees when duplicates found
- Returns structured response with batchId, insertCount, updateCount, errorCount
- Proper error handling with rollback awareness

**Import Wizard — Live DB Integration**
- Commit handler now calls real API route instead of simulated timeout
- Loading spinner during API call
- Error handling returns to preview step for retry
- Success navigation to import history page

**Vehicle Detail Page — Strong Types**
- Replaced loose `Record<string, unknown>` with proper `$inferSelect` types
- DefectRecord, MaintenanceRecord, DocumentRecord, OdometerRecord interfaces
- Direct property access on query results

### Fixed
- Phase 4 vehicle detail page: missing `EmptyState` and `Database` imports
- Vehicle detail tab data: `Record<string, unknown>` → proper `$inferSelect` types
- Import wizard: commit handler now calls real DB-backed API route
- Trip list: removed non-existent `sortOrder` column reference causing runtime DB errors
- Trip detail: removed dead `allocations` and `closures` queries that were fetched but never rendered
- Trip list: fixed requester label (was incorrectly labeled "Driver")
- All unused imports cleaned from Phase 6 files (lint compliance)

### Known Gaps (Phase 6)
- Tenant isolation not yet enforced on queries (requires auth session)
- No vehicle allocation page yet (allocation done via trips)
- No departure/return inspection forms — linked from trip detail
- CSV import API uses dummy tenantId until auth is wired

### Commands verified

- `pnpm typecheck` — passes (0 errors)
- `pnpm lint` — passes (0 errors, 0 warnings)
- `pnpm test` — passes (7 tests)
- `pnpm build` — passes

## 2026-07-14 — Phase 5: Transport requests and route calculation

### Added

**Transport Request List Page**
- DB-backed server component with search, status/scope filters, pagination
- Summary cards (total, pending approval, active/in-progress, closed)
- Status badges using STATUS_VARIANTS from constants
- Scope badges (regional = info, national = emergency)
- Proper error boundary: `isDbConnected()` check + try/catch fallback

**Transport Request Detail Page**
- Request summary card with requester info, department, purpose, authorised km
- Programme of Activities table with dates, venue, estimated km
- Passengers card with employee/external display, status badges
- Drivers card with driver type labels, confirmation + licence validation status
- Routes section with origin/destination visual layout, mapped distance, duration, override reasons
- Attachments section with file metadata
- Special Authority banner when applicable

**New Transport Request Wizard (Client Component)**
- 5-step form: Basic Info → Activities → Passengers & Drivers → Route → Review
- Step indicator with progress state (inactive/active/complete)
- Basic info: scope selector, purpose textarea, department input, special authority checkbox
- Activities: dynamic CRUD with title, venue, dates, estimated km, description
- Passengers & Drivers: dynamic CRUD with employee/external toggle
- Routes: origin/destination pairs with estimated distance and adapter message
- Review: reference preview, summary cards, itinerary list, detail panel
- Submit placeholder (simulates API call — ready for DB insert)

### Fixed
- Phase 4 vehicle detail page: missing `EmptyState` and `Database` imports causing TS2304 errors — added imports
- Unused imports cleaned from all new files (lint compliance)
- Unescaped entities in JSX fixed (`react/no-unescaped-entities`)

### Known Gaps (Phase 5)
- New request wizard submit handler simulates API call — needs real DB insert
- Route calculation uses manual estimate input — distance adapter not yet wired
- No tenant isolation on queries (requires auth session)
- No approval workflow integration yet

### Commands verified

- `pnpm typecheck` — passes (0 errors)
- `pnpm lint` — passes (0 errors, 0 warnings)
- `pnpm test` — passes (7 tests)
- `pnpm build` — passes

## 2026-07-14 — Phase 2: Database, authentication, tenancy and RBAC

### Added

**Database Schema (Drizzle ORM — 30+ tables)**
- Tenants, branding, memberships, roles, permissions, role-permissions mapping
- User profiles (Better Auth extension)
- Offices (hierarchical), departments, employees, employee documents
- Driver profiles and driver licences with history preservation
- Vehicle categories, vehicles, vehicle documents, status events, defects, maintenance, odometer events
- Transport requests, revisions, activities, passengers, drivers, routes, attachments
- Workflow definitions, steps, instances, actions, emergency overrides
- Vehicle allocations, trip authorities, trips, trip issues
- Inspection templates, items, inspections, item results, inspection photos
- Trip log entries, fuel transactions, fuel receipts, reimbursements, trip closures
- Generated documents, share links, share access events
- Notifications, notification deliveries, notification preferences
- Import batches, import rows
- Audit events with hash chain (previous/current hash)

**Auth & Security**
- Better Auth configuration (password-only, no public sign-up)
- Permission constants with 30+ permission codes
- 9 role definitions matching permission matrix (Transport Admin, Requester, Supervisor, Control Admin Officer, Deputy Director, Director, CRO, Driver, Auditor)
- Tenant resolver utilities (verifyTenantMembership, getUserTenants, requireTenantAccess)
- Tenant-scoped query helper
- RLS context SQL utility

**Seed Data**
- Kavango East Regional Council tenant
- 1 head office + 6 constituency + 1 settlement office
- 5 departments, 10 employees
- 3 vehicle categories, 5 vehicles
- 9 roles with permissions
- Regional and National workflow definitions with 5 steps each

### Commands verified

- `pnpm typecheck` — passes
- `pnpm lint` — passes (0 errors, 0 warnings)
- `pnpm test` — passes (7 tests)
- `pnpm build` — passes

## 2026-07-14 — Phase 1: Design system and application shell

### Added

- **UI Components:**
  - Button component with 7 variants (primary, secondary, tertiary, destructive, ghost, outline, emergency)
  - Badge and StatusBadge with dot + label pattern for workflow statuses
  - Card, StatCard, CardHeader, CardTitle, CardDescription, CardContent, CardFooter
  - Dialog component with Radix UI (overlay, content, header, footer, title, description)
  - Input, Textarea, Label, FieldWrapper, FormError components
  - Select component with Radix UI (trigger, content, item, separator)
  - ConfirmDialog with typed confirmation support and useConfirm hook
  - EmptyState, LoadingSkeleton, LoadingState, ErrorState, PermissionDenied, OfflineBanner

- **Application Shell:**
  - Sidebar with 7 navigation groups, collapsed/expanded states (248px/72px)
  - MobileSidebar as slide-over drawer for mobile navigation
  - TopBar with search, notifications indicator, profile dropdown
  - PageHeader with title, description, action slot
  - Breadcrumbs component
  - DashboardShell orchestrating sidebar + topbar + content

- **Route Groups:**
  - `(dashboard)` route group with DashboardShell layout
  - Dashboard home page with KPI cards, recent requests, fleet summary
  - `(auth)` route group with centered layout
  - Login page with password visibility toggle

- `tailwindcss-animate` package installed for Radix UI transitions
- All lint warnings fixed (0 warnings, 0 errors)

### Commands verified

- `pnpm typecheck` — passes
- `pnpm lint` — passes (0 errors, 0 warnings)
- `pnpm test` — passes (7 tests)
- `pnpm build` — passes

## 2026-07-14 — Phase 0: Repository and verified foundation

### Added

- Git repository initialised
- Next.js 16.2.10 project scaffolded with TypeScript strict mode
- All core dependencies installed (pnpm 10.12.4, Node.js 22.16.0)
- Prettier configuration with Tailwind CSS plugin
- Vitest unit test configuration with jsdom environment
- Vitest integration test configuration
- Playwright E2E test configuration
- Drizzle ORM configuration (PostgreSQL dialect)
- Environment variable validation with Zod (`src/env.ts`)
- Environment template (`src/.env.example`)
- GitHub Actions CI workflow (`lint → typecheck → test → build`)
- Root layout with Onest font via `next/font/google`
- Global CSS with Tailwind v4 `@theme` design tokens (brand, status, spacing, radius)
- Landing page with hero, features grid, workflow steps and pilot section
- Providers wrapper (TanStack Query + Toast)
- Toast component (Radix UI-based with success/error/pending variants)
- Utility functions: `cn()`, `formatNumber()`, `formatCurrency()`, `formatDate()`, `formatDateTime()`, `generateId()`, `delay()`, `pluralize()`
- Application constants: status labels, trip scopes, page sizes, upload limits
- `next.config.ts` with security headers and image remote patterns
- `.gitignore` with project-specific entries
- Architecture.md updated with Implemented versions section
- Basic unit tests for utility functions (7 tests passing)

### Commands verified

- `pnpm typecheck` — passes
- `pnpm lint` — passes (0 errors, 0 warnings)
- `pnpm test` — passes (7 tests)
- `pnpm build` — passes

### Documentation

- All core and optional specification documents preserved
- Architecture.md version table appended
- PROJECT-STATUS.md updated to Phase 0 complete

### Implementation status

Phase 4 complete. Phase 5 ready to begin.

## 2026-07-14 — Phase 4: Fleet, defects, maintenance and CSV parser fix

### Added

**Fleet Vehicle List**
- DB-backed server component with search, filters, pagination
- Summary cards (available, on-trip, maintenance, out-of-service)
- Vehicle rows with make/model, GRN, odometer, status badges
- Defect and maintenance counts per vehicle
- Filter by status, category, and free-text search (GRN, make, model)

**Vehicle Detail Page**
- Summary card with full vehicle details (GRN, registration, year, colour, transmission, engine, fuel card)
- Tabbed interface: Documents, Defects, Maintenance, Odometer History
- Explicit Drizzle joins (no relations API) with proper getDb() pattern
- Documents table with type badges, expiry, verification status
- Defect cards with severity badges, open/resolved status, blocking indicators
- Maintenance events with dates, odometer, cost, vendor, upcoming services
- Odometer history table with source tracking

**Defect Tracking Page**
- Cross-fleet defect list with severity-based sorting (critical → informational)
- Summary cards (total, open, resolved)
- Filter by status (open/resolved/all) and severity
- Blocking defect highlighting with visual emphasis

**Maintenance History Page**
- Cross-fleet maintenance events with service filters
- Summary cards (total events, total cost, upcoming services, scheduled)
- Vendor tracking and next-service-due dates

**Tabs Shell (Client Component)**
- Reusable tab navigation client component for vehicle detail page

**CSV Parser Fix**
- Upgraded from naive `split(',')` to `papaparse` (already in package.json)
- Properly handles quoted fields, commas within fields, multi-line values
- Preserves all existing auto-mapping, validation, and error reporting

### Fixed
- All Phase 4 pages use `getDb()` pattern instead of nullable `db` export
- Explicit Drizzle joins replace missing relations API usage
- `isNotNull` imported correctly from `drizzle-orm`
- `sql<number>\`count(*)\`` used instead of non-existent `.count()` method
- Unused imports and variables cleaned across all pages
- Severity badge variants use proper type-safe mappings

### Known Gaps (Phase 4)
- No try/catch error boundaries on data fetching (unlike Phase 3 pages)
- Vehicle detail tab data uses loose `Record<string, unknown>` types (needs proper result interfaces)

### Commands verified

- `pnpm typecheck` — passes (0 errors)
- `pnpm lint` — passes (0 errors, 0 warnings)
- `pnpm test` — passes (7 tests)
- `pnpm build` — passes

## 2026-07-14 — Phase 3: Staff directory, offices and CSV import

### Added

**Staff Directory**
- Server component with DB-backed queries (employees, departments, offices joins)
- Search by name, employee number, email, job title
- Filters by office, department, employment status
- Paginated results with URL search params
- Clean state handling: DB-not-configured, empty results, query errors

**Employee Detail**
- Profile card with initials avatar, contact info, status, department/office
- Driver profile section with status, authorisation, licence count
- Driver licence history with class, number, issue/expiry, verification status
- Documents section with document type, name, expiry, verification badge

**Offices & Departments**
- Hierarchical office tree (head office → constituency → settlement)
- Colour-coded office type indicators
- Employee counts per office and department
- Departments listing with code display

**Import Wizard (Client Component)**
- 4-step flow: Upload → Column Mapping → Preview/Validate → Complete
- Auto-mapping of known CSV column names
- Row-level validation with error reporting
- Summary cards (total, valid, errors)
- Paginated data preview table
- Validation error detail cards
- Committing state with spinner animation
- Completion state with navigation actions

**Import History**
- Server component with DB-backed batch listing
- Status badges, row counts, date display
- Empty state for no imports

**Button Component**
- `asChild` prop support using `React.Children.only` + `cloneElement`
- Enables composable button-links (e.g., `<Button asChild><Link>...</Link></Button>`)

### Fixed
- `isNotNull` import from `drizzle-orm` instead of column method call
- `notFound()` handling extracted outside try/catch
- Removed `.xlsx` from import accept list (XLSX parsing not yet implemented)
- All JSX moved outside try/catch blocks (ESLint compliance)
- Removed unused imports and dead variables

### Known Gaps
- CSV parser uses naive `split(',')` — upgrade to `papaparse` (already in package.json)
- Import commit handler is a placeholder (`setTimeout`) — needs DB insert logic
- Tenant isolation not yet enforced on queries (needs auth session)
- Download Template button is non-functional

### Commands verified

- `pnpm typecheck` — passes
- `pnpm lint` — passes (0 errors, 0 warnings)
- `pnpm test` — passes (7 tests)
- `pnpm build` — passes
