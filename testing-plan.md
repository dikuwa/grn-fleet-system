# Testing Plan

## Tooling

- Vitest for unit tests
- React Testing Library for component behaviour
- Playwright for browser E2E and responsive checks
- Isolated PostgreSQL test database for integration tests
- Mock Service Worker or controlled adapters for external APIs
- Axe checks in component/E2E tests
- PDF text/content assertions and selected visual snapshots

## Unit tests

- request status and transition guards;
- route-distance total calculations;
- vehicle recommendation rules;
- vehicle availability predicates;
- licence validity and override logic;
- odometer and fuel anomaly rules;
- workflow reminder/escalation calculations;
- redaction profiles;
- share token hashing/expiry;
- audit canonicalisation/hash chain;
- import field mapping and row validation;
- offline draft merge/conflict rules.

## Integration tests

- Better Auth session and password-change flow;
- tenant resolver and RLS policies;
- role/capability assignments and acting dates;
- request submission transaction;
- workflow action plus audit event;
- concurrent vehicle allocation lock;
- inspection/release/authorisation prerequisites;
- trip issue and closure;
- storage presign validation;
- email outbox and idempotent retry;
- import batch commit/rollback;
- document version creation;
- report aggregates.

## Permission tests

Create a matrix for every endpoint and role. Include:

- requester cannot approve own request;
- supervisor cannot allocate vehicle without permission;
- Transport Administrator cannot perform final authorisation unless separately assigned and separation rules permit;
- release actor cannot final-authorise same trip;
- driver sees only assigned trip and allowed fields;
- passenger directory user has no account access;
- tenant auditor cannot mutate;
- platform admin cannot see tenant private content without explicit audited support permission;
- cross-tenant IDs always return not found/forbidden without data disclosure.

## Workflow E2E scenarios

1. Regional happy path from draft to closure.
2. National happy path from draft to closure.
3. Supervisor rejection, requester revision and resubmission.
4. Cancellation before allocation.
5. Cancellation after issue requiring return inspection.
6. Vehicle replacement before authorisation.
7. Vehicle replacement after authorisation causing re-release/re-authorisation.
8. Emergency override with post-trip review.
9. Licence expiry block and audited override.
10. Defect discovered at departure blocks issue.
11. Late return and kilometre variance.
12. Offline daily log, reconnect and sync.
13. Sync conflict resolution.
14. Fuel receipt missing/duplicate/out-of-period.
15. Trip closure and vehicle availability restoration.

## Import tests

- CSV and XLSX files;
- unexpected headers;
- manual column mapping;
- blank required fields;
- duplicate employee number/email/licence;
- mixed date formats;
- invalid gender or role values;
- row correction;
- partial validation without commit;
- import cancellation;
- large pilot-sized file;
- no automatic login account creation.

## File tests

- allowed and disallowed MIME types;
- maximum file size;
- malicious filename/path characters;
- private storage key prefix;
- signed URL expiry;
- tenant access denial;
- image orientation and metadata handling;
- deletion rules preserving document evidence.

## PDF tests

- correct tenant logo and contact details;
- draft watermark;
- approval names, roles and timestamps;
- long names and comments wrap without clipping;
- multi-page logsheet;
- QR/verification reference;
- sensitive fields redacted in external profile;
- generated hash and version;
- print margins and page numbers.

## Offline/PWA tests

- installability and manifest;
- service worker update;
- app shell opens during temporary loss;
- no broad caching of sensitive API responses;
- draft saved after refresh;
- sync only to correct user/tenant;
- repeated sync does not duplicate;
- logout clears local sensitive drafts;
- stale server version produces conflict.

## Accessibility tests

- keyboard flow through navigation, wizard, tables and dialogs;
- focus trapped/restored in overlays;
- visible focus;
- labels and error association;
- status not colour-only;
- touch targets;
- responsive zoom;
- reduced motion;
- contrast AA.

## Performance tests

- dashboard and request-list query plans;
- no N+1 on request detail/timeline;
- pagination under large synthetic data;
- export job memory use;
- image and PDF dynamic imports;
- marketing Web Vitals;
- API p95 smoke test.

## Security tests

- IDOR/cross-tenant access;
- CSRF/session cookie configuration;
- brute-force login rate limit;
- share-token guessing and replay;
- expired/revoked share links;
- stored XSS in comments/names;
- SQL injection resistance through parameterisation;
- upload content validation;
- privilege escalation through acting assignments;
- audit log mutation attempt;
- secret leakage in client bundles/logs.

## Release criteria

- All critical workflow E2E tests pass.
- No critical/high security finding is open.
- Type-check, lint, unit, integration, E2E and build pass.
- Accessibility has no serious/critical automated violations.
- Backup restore has been rehearsed in staging.
