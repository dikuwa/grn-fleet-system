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

### Commands verified

- `pnpm typecheck` — passes (0 errors)
- `pnpm lint` — passes (0 errors, 0 warnings)
- `pnpm build` — passes
