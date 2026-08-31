# Runtime Scale Closure Audit — 2026-08-30

Authoritative starting point: `79938ff53621d64b872b2426fdd6603980e04f7c`.

## Verified / guarded

- Employee requester/passenger/driver selection uses the tenant-scoped `/api/people-search` endpoint with debounced server-side search and pagination rather than preloading a fixed roster.
- The existing CI page benchmark now includes the Programmes register and directly times the authenticated `/api/programmes/:id` endpoint consumed by Programme Detail.
- The all-role browser matrix now verifies dark-theme persistence across Notifications and Documents/restricted Documents navigation for every seeded role, then verifies the Light transition after returning to the dashboard.
- Staff import transaction duration is now guarded by a tested synchronous batch ceiling of 500 rows. Oversized imports are rejected with HTTP 413 before database acquisition or tenant preload work begins, while accepted batches retain the existing all-or-nothing transaction path.
- Transport Request Programme selection now uses a debounced server-backed searchable combobox with 20-row requested windows instead of a bounded preload. Search remains tenant-scoped and limited to current approved/published, non-archived programmes; a selected programme is hydrated directly by ID so it remains visible even when it is outside the latest search window, including `?programmeId=` deep links.

## Follow-up findings

No unresolved runtime-scale findings remain from this closure slice.
