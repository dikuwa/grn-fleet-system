# Architecture

## 1. Architecture summary

A modular Next.js application serves the public site, authenticated dashboard, APIs, document rendering and secure external views. PostgreSQL is the system of record. Tenant context and permissions are resolved server-side. Private files live in object storage. Background jobs deliver email reminders and escalation. Driver offline drafts are stored locally and synchronised through conflict-aware APIs.

## 2. Selected technologies

| Layer | Selection | Reason |
|---|---|---|
| Web framework | Current stable Next.js App Router | Full-stack routing, server components and Vercel deployment |
| Language | TypeScript strict mode | Safer workflow and data modelling |
| UI | Tailwind CSS, shadcn-compatible primitives, VibeKit/JB components | Accessible, source-owned components |
| Icons | Lucide React | Consistent restrained line icons |
| Motion | Framer Motion | One controlled animation library |
| Database | Neon PostgreSQL | Managed Postgres, branching and prototype scalability |
| ORM | Drizzle ORM | Approved typed SQL approach and transparent migrations |
| Authentication | Better Auth | Secure sessions and password workflows; customised for no public sign-up |
| Forms | React Hook Form + Zod | Shared client/server validation |
| Data tables | TanStack Table | Server pagination, filtering and exports |
| Client fetching | TanStack Query selectively | Interactive lists, optimistic updates and sync |
| Storage | Cloudflare R2, private bucket | S3-compatible private documents and photos |
| Email | Resend + React Email | Transactional workflow email |
| Maps | Google Places + Routes API | Verified locations and road distance |
| PDFs | `@react-pdf/renderer` | Component-based official document layouts |
| CSV/Excel | Papa Parse + ExcelJS | Imports, validation and exports |
| PWA | Serwist + Dexie | Installability, service worker and offline drafts |
| Background jobs | Inngest | Durable reminders, retries and scheduled escalation |
| Rate limiting | Upstash Redis | Auth/share-link protection and short-lived coordination |
| Monitoring | Sentry | Errors, traces and release visibility |
| Hosting | Vercel | Fast prototype deployment and previews |
| DNS/WAF | Cloudflare | DNS, SSL and optional WAF controls |

Exact versions must be verified and locked during Phase 0.

## 3. Deliberately rejected or deferred

- **Prisma:** rejected because Drizzle was approved in the discovery summary.
- **Broad Redis caching:** deferred; use server components and database indexing first.
- **Stripe/payment stack:** irrelevant.
- **WhatsApp API:** explicitly excluded.
- **Active SMS:** disabled future interface only.
- **Realtime sockets:** not needed; use short polling/revalidation for notifications in v1.
- **Microservices:** unnecessary for pilot scale.
- **Docker in normal Vercel deployment:** not required; provide optional local Postgres compose file only if useful.
- **Full AI decision-making:** rejected for official distance, approval and allocation authority.
- **Dark mode:** deferred.

## 4. Application boundaries

Suggested route groups:

```text
app/
├── (marketing)/
├── (auth)/
├── (dashboard)/
├── share/[token]/
├── verify/[reference]/
└── api/
```

Suggested modules:

```text
src/modules/
├── auth
├── tenancy
├── people
├── offices
├── fleet
├── maintenance
├── transport-requests
├── workflows
├── allocations
├── inspections
├── trips
├── logsheets
├── fuel
├── documents
├── sharing
├── notifications
├── reports
├── imports
└── audit
```

Each module owns schema fragments, domain services, permissions, route handlers, UI and tests. Avoid a large generic `utils` folder.

## 5. Rendering strategy

- Server Components by default for authenticated pages and initial data.
- Client Components only for interactive forms, data tables, maps, offline sync and rich UI.
- Route handlers for public APIs, mutations and background integrations.
- No sensitive data in client bundles or page source.
- Dynamic import PDF preview, charts, Excel processing and map widgets.

## 6. Database and migrations

- Drizzle schema split by domain but exported through one index.
- UUID primary keys.
- `tenant_id` on every tenant-owned table.
- `created_at`, `updated_at`, `created_by`, `updated_by` where relevant.
- Soft deletion only for operational master data that may be restored; audit history is never soft-deleted.
- Optimistic concurrency using integer `version` for request, trip and vehicle records.
- Composite indexes begin with `tenant_id`.
- PostgreSQL row-level security as defence in depth.
- Migrations are committed, reviewed and non-destructive.

## 7. Authentication

- Password-based login only in v1.
- No public sign-up.
- New accounts created by authorised administrators.
- Temporary password and required first-login change.
- Password reset through admin and optional email token.
- Secure, HTTP-only, same-site cookies.
- Session revocation on suspension or password reset.
- Account records remain after deactivation to preserve audit references.

## 8. Tenancy

- Authenticated session resolves allowed tenant memberships.
- Active tenant is selected from server-verified membership.
- Client-submitted tenant IDs are ignored or validated against the session.
- Platform administrators use separate platform permissions.
- Storage paths use `tenants/{tenantId}/...`.
- External share records point to one tenant and one redaction profile.
- RLS policies compare tenant context set by the server transaction.

## 9. Permissions

Use capability-based permissions, not scattered role-name checks. Roles map to permissions such as:

- `request:create`
- `request:approve-supervisor`
- `allocation:manage`
- `vehicle:release-regional`
- `vehicle:release-national`
- `trip:authorize-regional`
- `trip:authorize-national`
- `inspection:perform`
- `trip:close`
- `staff:import`
- `audit:read`
- `tenant:manage`

Domain services enforce separation-of-duties rules in addition to permissions.

## 10. Workflow engine

Use configurable workflow definitions stored per tenant and trip scope. A workflow instance is created from a versioned definition when the request is submitted. Later configuration changes do not alter active/historical instances.

Each step defines:

- responsible permission/role;
- order;
- action type;
- prerequisites;
- whether comments are required;
- reminder and escalation policy;
- whether emergency override is allowed;
- separation-of-duties constraints.

State transitions occur in database transactions and append audit events.

## 11. Maps and routes

- Browser key restricted to approved origins for Places autocomplete/maps.
- Server key restricted by API and server environment for Routes API.
- Store origin/destination place IDs, coordinates, formatted names, route distance, duration, polyline and calculation timestamp.
- Additional kilometres are a separate user-entered value with reason.
- Manual mapped-distance override requires permission and audit reason.
- Route calculation failures offer manual entry with “unverified route” status.

## 12. Vehicle recommendation

A deterministic rules service scores eligible vehicle categories. Inputs include passenger capacity, terrain, route scope, road surface, duration, luggage, accessibility and active vehicle status. An optional LLM can convert the scoring result into a readable explanation, but the scored result and administrator choice remain authoritative.

## 13. Files and storage

Private categories:

- employee/driver documents;
- vehicle documents;
- inspection photographs;
- fuel receipts;
- signatures;
- generated PDFs;
- import files.

Uploads use presigned URLs, MIME/type validation, maximum size, content-disposition controls and tenant-prefixed keys. Signed downloads are short-lived. Never expose R2 credentials to the browser.

## 14. Documents

Document snapshots store the exact data and template version used at generation. A regenerated document creates a new version rather than silently altering issued evidence. The database stores hash, storage key, generation reason and visibility/redaction profile.

## 15. Notifications and jobs

A transaction creates notification records and outbox events. Inngest handles email delivery, reminders, escalation and retries. In-app notifications are database-backed. Jobs are idempotent and keyed by event type and entity ID.

Manual WhatsApp sharing creates a secure link and opens the device/browser share target. No WhatsApp API credentials or webhooks.

## 16. PWA and offline data

- Service worker caches application shell and safe static assets.
- Dexie stores draft log entries and incomplete inspection drafts.
- Sensitive full records are not broadly cached.
- Every draft has client ID, tenant ID, user ID, updated time and sync state.
- Sync API is idempotent.
- Server rejects stale or invalid drafts with a conflict response.
- User must resolve conflicts before final submission.
- Approvals and vehicle issue always require connectivity.

## 17. Reporting

Operational reports use indexed SQL queries, server-side pagination and export jobs for large ranges. Start with direct exports for pilot volumes. Generated reports are stored as documents when long-running or shared.

## 18. Audit integrity

Audit events are append-only. Each event stores canonical payload hash and previous hash within the tenant chain. A verification job checks continuity. Updates to business records include the related audit event in the same transaction where practical.

## 19. Security

- server-side authentication and permission checks;
- tenant scoping and RLS;
- CSRF protection from auth framework and same-site cookies;
- rate limits for login, reset, share and verification routes;
- Zod validation on every mutation;
- output encoding and CSP;
- secure headers;
- upload validation and private storage;
- redaction profiles;
- audit and anomaly monitoring;
- dependency and secret scanning in CI;
- backups and restore drills.

## 20. Performance targets

- Marketing LCP under 2.5s on normal mobile connection.
- Dashboard route p95 server response under 800ms at pilot scale.
- CLS under 0.1.
- Paginate lists over 50 records.
- Dynamic import maps, PDFs, charts and spreadsheet processing.
- Use indexes for tenant/status/date and vehicle availability queries.
- Avoid N+1 queries and unbounded exports.

## 21. Deployment

Prototype environments:

- Local
- Preview per pull request
- Staging
- Production

Use separate databases, buckets and credentials. Production migrations run through CI with a backup and rollback note. Domain and email sender verification occur before launch.

## 22. Scaling path

The modular monolith is expected to support the pilot and multi-region adoption. Scale first through database indexing, read replicas, export jobs and job concurrency. Extract services only when measured load or organisational ownership justifies it.

## 23. Implemented versions (Phase 0)

Locked on 2026-07-14 with pnpm 10.12.4 on Node.js 22.16.0.

| Layer | Selection | Version |
|---|---|---|
| Web framework | Next.js | 16.2.10 |
| Language | TypeScript | 5.8.x |
| UI | Tailwind CSS | 4.1.6 |
| UI primitives | shadcn-compatible Radix UI | Various 1.x |
| Icons | Lucide React | 0.510.x |
| Motion | Framer Motion | 12.x |
| Forms | React Hook Form | 7.54.x |
| Validation | Zod | 3.24.x |
| ORM | Drizzle ORM | 0.40.x |
| Migration tool | Drizzle Kit | 0.30.x |
| Database driver | @neondatabase/serverless | 1.0.x |
| Auth | Better Auth | 1.1.x |
| Data tables | @tanstack/react-table | 8.21.x |
| Client fetching | @tanstack/react-query | 5.75.x |
| PDF generation | @react-pdf/renderer | 4.1.x |
| CSV parsing | Papa Parse | 5.5.x |
| Excel generation | ExcelJS | 4.4.x |
| PWA offline | Dexie | 4.0.x |
| Email | Resend | 4.1.x |
| Email templates | @react-email/components | 0.0.30 |
| Object storage | @aws-sdk/client-s3 | 3.750.x |
| Background jobs | Inngest | 3.30.x |
| Rate limiting | @upstash/redis | 1.34.x |
| Monitoring | @sentry/nextjs | 9.x |
| Testing | Vitest + Playwright | 3.x / 1.50.x |
| Runtime helpers | tsx | 4.19.x |
| Utilities | date-fns | 4.1.x |
| Image processing | sharp | 0.34.x |
