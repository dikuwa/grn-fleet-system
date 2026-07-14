# Multi-Tenant Specification

## Tenant model

A tenant represents one regional council, ministry, office or agency. Kavango East is the pilot tenant.

Each tenant owns:

- branding and official details;
- offices, departments and staff;
- users and role assignments;
- fleet and maintenance records;
- workflow definitions;
- requests, trips, documents and audit events;
- notification schedules and numbering rules.

## Tenant resolution

Authenticated APIs derive tenant context from the session and active membership. The browser may request a membership switch, but the server validates it. Do not accept a raw tenant ID as authority.

Public share links resolve one tenant through a hashed token. Public landing pages have no tenant context unless serving an explicitly published tenant pilot page.

## Isolation controls

1. `tenant_id` on every tenant-owned row.
2. Query helpers require tenant context.
3. PostgreSQL RLS.
4. Storage keys prefixed by tenant.
5. Background job payloads include tenant and revalidate it.
6. Cache/rate-limit keys include tenant where relevant.
7. Logs avoid cross-tenant aggregation of sensitive content.
8. Automated cross-tenant test suite.

## Office hierarchy

Offices use a parent/child tree and types such as:

- head office;
- constituency office;
- settlement office;
- directorate/operational unit.

All vehicle allocation remains centralised with the tenant Transport Administrator. Office-scoped roles may view or manage local records only when granted.

## Platform administration

Platform Super Administrator can:

- create/suspend tenant;
- configure platform limits;
- view tenant health metadata;
- initiate audited support access if later enabled.

It must not silently browse tenant operational data or approve requests.

## Tenant onboarding

1. Create tenant and code.
2. Upload branding and official contact.
3. Set timezone, locale and numbering pattern.
4. Create office hierarchy.
5. Load default regional/national workflow definitions.
6. Create Transport Administrator.
7. Import employees and vehicles.
8. Configure business hours, reminders and document signatories.
9. Run test request.
10. Activate tenant.

## Customisation boundaries

Configurable:

- names/branding;
- office structure;
- workflow role assignments and reminders;
- document numbers;
- inspection checklist;
- vehicle categories;
- emergency policy;
- data retention/archival.

Not tenant-customisable without platform release:

- security controls;
- audit immutability;
- core separation-of-duties safeguards;
- arbitrary executable code;
- storage location/credentials through dashboard.

## Future hosting migration

All vendor integrations use adapters and tenant-neutral domain services. PostgreSQL, S3-compatible storage, email, job queue and maps can be replaced for government hosting without rewriting business workflows.
