# Runtime Scale Closure Audit — 2026-08-30

Authoritative starting point: `79938ff53621d64b872b2426fdd6603980e04f7c`.

## Verified / guarded

- Employee requester/passenger/driver selection uses the tenant-scoped `/api/people-search` endpoint with debounced server-side search and pagination rather than preloading a fixed roster.
- The existing CI page benchmark now includes the Programmes register and directly times the authenticated `/api/programmes/:id` endpoint consumed by Programme Detail.
- The all-role browser matrix now verifies dark-theme persistence across Notifications and Documents/restricted Documents navigation for every seeded role, then verifies the Light transition after returning to the dashboard.
- Staff import transaction duration is now guarded by a tested synchronous batch ceiling of 500 rows. Oversized imports are rejected with HTTP 413 before database acquisition or tenant preload work begins, while accepted batches retain the existing all-or-nothing transaction path.

## Follow-up findings

### Programme selection at tenant scale

The Transport Request wizard currently fetches `/api/programmes?selectable=1&limit=50` into a plain select. The API overrides selector mode to a bounded 500-row result, so the immediate 50-row truncation is avoided, but a tenant with more than 500 current approved/published programmes can still have a valid programme that cannot be selected. A searchable server-backed Programme combobox should replace the bounded preload.
