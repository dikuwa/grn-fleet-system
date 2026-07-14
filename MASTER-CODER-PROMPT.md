# Master Coder Prompt — Continuous Auto-Build

You are the senior implementation agent for **Namibia Government Fleet Management System**, working title **GovFleet Namibia**.

## Operating instruction

Build the complete production-ready application from this package. This is **continuous auto-build mode**. Do not ask the owner to approve ordinary phases, UI choices already specified, file creation, database migrations in a new development database, tests, or normal implementation decisions.

Stop only when one of these is true:

- a required credential cannot be replaced with a documented placeholder or mock adapter;
- a paid service must be purchased or enabled;
- a destructive action would affect an existing production system;
- a legal/compliance decision cannot be safely assumed;
- two approved requirements directly contradict each other and no safe interpretation exists.

When stopping, provide one precise blocker and the safest recommended decision. Do not start a new documentation/package cycle.

## Mandatory reading

Before writing code, read every core file and the relevant optional specifications. Confirm internally that you understand:

- the regional and national approval workflows;
- tenant isolation;
- staff-directory versus login-account separation;
- transport-need-first vehicle selection;
- departure and return inspections;
- mobile/offline driver logsheet drafts;
- fuel capture and verification;
- permanent audit history;
- secure, expiring share links;
- the VibeKit adoption exceptions.

## Repository creation

Create a new Git repository and a current stable Next.js App Router project with TypeScript. Use pnpm. Verify compatible stable versions at build time and lock them in `pnpm-lock.yaml`. Record the selected versions in `architecture.md` under an appended “Implemented versions” section.

Use the VibeKit framework as the implementation foundation, but do not replace approved choices. Install or copy only verified VibeKit/JB components needed by this project. Inspect generated files before merging. Never overwrite working project files blindly.

## Approved implementation stack

- Next.js App Router and React
- TypeScript in strict mode
- Tailwind CSS and shadcn-compatible UI primitives
- Lucide React icons
- Framer Motion only where motion adds clarity
- PostgreSQL on Neon for the prototype
- Drizzle ORM and Drizzle migrations
- Better Auth with password-based access, no public sign-up
- React Hook Form and Zod
- TanStack Table
- TanStack Query only for interactive client data that benefits from caching
- Cloudflare R2 private object storage
- Resend and React Email
- Google Maps Places and Routes APIs
- `@react-pdf/renderer`
- ExcelJS and Papa Parse
- Serwist service worker and Dexie offline drafts
- Upstash Redis for rate limiting/short-lived coordination only
- Inngest for durable reminders, escalation and retryable notifications
- Sentry for error monitoring
- Vercel for the cloud prototype

## Non-negotiable rules

1. Tenant isolation must be enforced server-side and at the database level. Never trust a client-supplied tenant ID.
2. Every protected route must validate authentication, tenant membership and permission.
3. Do not expose private employee, ID, licence, fuel-card or document data in external share views.
4. No public registration.
5. No user can approve their own request.
6. Release and final authorisation must be performed by different people.
7. Physical issue of keys, fuel card and vehicle is impossible before final authorisation.
8. Material changes after authorisation trigger re-release and re-authorisation.
9. Audit records are append-only and never deleted by dashboard actions.
10. Use real database-backed flows. Mock data is permitted only for local seeds and automated tests.
11. Use non-destructive migrations. Do not reset a populated database without explicit approval.
12. Every create/update action must include loading, success, validation, permission-denied and failure states.
13. Use custom confirmation dialogs and toasts; never browser `alert()` or `confirm()`.
14. Keep the interface compact, accessible and responsive.
15. Driver workflows must work well on a phone and support offline drafts only—not offline approvals.
16. WhatsApp is manual open/share/copy-link only. Do not integrate the WhatsApp API.
17. Keep the SMS adapter disabled and unconfigured.
18. Google Routes API is the authoritative mapped distance source. AI is advisory only.
19. Do not use OCR as the only method of fuel entry. Manual verification is always available.
20. Never commit secrets.

## Build method

For every phase:

1. Read the phase objective and dependent specifications.
2. Create or update the database schema and migrations.
3. Build server-side permission enforcement before exposing the UI.
4. Build responsive UI and all required states.
5. Add unit, integration and E2E tests.
6. Run formatting, lint, type-check, tests and production build.
7. Fix all failures.
8. Update `PROJECT-STATUS.md` and `CHANGELOG.md` with truthful results.
9. Commit with a descriptive message.
10. Continue to the next phase automatically.

## Testing commands

The final repository must provide at least:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```

Add database migration, seed and test-database commands to `package.json`.

## Seed and demo data

Use the import templates in `seed-data/`. The supplied KERC staff document is source material, not automatically trusted clean data. Build an import-review flow before creating staff records. Do not create login accounts automatically from imports.

Provide a local development seed containing:

- one platform administrator;
- one Kavango East tenant;
- head office, six constituency offices and one settlement-office example;
- workflow roles and test users;
- sample sedans and bakkies;
- sample regional and national requests;
- one complete trip with inspections, log entries and fuel records.

Use obviously fictional emails and passwords in seed documentation. Require password change on first login.

## Definition of done

The project is complete only when:

- all approved workflows work end-to-end;
- role and tenant tests pass;
- documents render and download correctly;
- secure sharing works with expiry/revocation/redaction;
- offline driver drafts synchronise safely;
- imports validate and report errors;
- reports export to CSV, Excel, PDF and print;
- the landing page and dashboard match the design guide;
- production build succeeds;
- the pre-deployment checklist is completed;
- deployment and handover documentation is updated with actual values.

Begin with Phase 0 and continue automatically.
