# Changelog

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

Phase 2 complete. Phase 3 ready to begin.
