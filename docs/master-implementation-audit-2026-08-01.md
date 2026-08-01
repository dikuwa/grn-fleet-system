# Master implementation audit — 1 August 2026

## Scope and method

This audit maps the master Transport Request, Trip Authority, Driver Daily Log and offline
event brief onto the existing application. It is based on source routes, Drizzle schemas,
migrations, domain services and existing unit/integration/Playwright coverage. It does not
assume a feature is complete because a page or table exists.

## Reuse map

| Capability | Existing route/component | Existing model/service | Audit finding | Reuse / repair decision |
|---|---|---|---|---|
| Transport Request | `/dashboard/requests`, `/dashboard/requests/new`, `/api/transport-requests` | `transportRequests`, activities, routes, passengers, drivers, attachments | Mature multi-step and secure-request implementation with workflow links | Reuse; preserve request identity and snapshots |
| Secure external request | `/request/[tenantSlug]`, OTP/verify/submit/track APIs | secure request token and rate-limit utilities | Token-scoped public flow and tests exist | Reuse; no public dashboard exposure |
| Approval and delegation | `/dashboard/approvals`, `/dashboard/delegations`, workflow admin | workflow definitions/instances/actions, delegation service | Role assignment, separation of duty and audit coverage exist | Reuse existing workflow engine |
| Allocation | `/dashboard/allocations`, allocation APIs | `vehicleAllocations`, vehicle recommender | Conflict and licence checks exist | Reuse; no second allocation system |
| Trip Authority lifecycle | `/dashboard/trips/[id]/authority`, authority APIs | `tripAuthorities`, immutable versions, passengers, drivers, amendments | Strong lifecycle and snapshot implementation; PDF layout did not match the approved document standard | Preserve lifecycle; repair shared renderer and section order |
| Official documents | `/dashboard/documents`, PDF/share/verification APIs | generated documents, versions, share links, generator/validation services | One shared renderer exists, but used Onest, blue rules and a corporate header | Restyle shared primitives; retain generation, verification and sharing |
| Driver workspace | `DriverTripWorkspace`, `/dashboard/driver-mobile`, trip operations API | trips, progress, expenses, incidents | Active-trip actions and offline drafts exist; incident form/schema were underspecified | Extend existing workspace and authoritative incident record |
| Driver Daily Log | `/dashboard/logs`, `/api/trip-logs` | `tripLogEntries` | Persisted and idempotent log creation exists; incident action was not available from the log form | Link the structured event action from the log workflow |
| Offline drafts/sync | `/dashboard/offline`, `/dashboard/sync-conflicts`, Dexie sync utilities, service worker | client-generated draft IDs and server idempotency columns | Existing retry/conflict UI; request drafts were incorrectly routed to trip logs and inspection sync forwarded tenant ID | Repair mappings; keep tenant derived from session |
| Incident/accident/defect | trip operations API and `/api/incidents` | `tripIncidents` | One table existed, but lacked official number, severity, continuation state and downstream safety routing | Extend existing table; do not create a parallel incident model |
| Vehicle safety | fleet defects, readiness and availability APIs | vehicles, defects, status events | Blocking defects already prevent departure/allocation | Feed critical trip defects into this existing mechanism |
| Maintenance | `/dashboard/maintenance`, maintenance API | `maintenanceEvents` | Existing repair history and maintenance vehicle state | Auto-create follow-up for critical trip defects |
| Return inspection | `/dashboard/inspections/return`, inspections API | inspections, results, photos, defects | Existing comparison/defect flow, but driver events were not visible before inspection | Surface linked authoritative events without re-entry |
| Trip completion | closure review and close APIs, Trip Completion PDF | `tripClosures`, document generator | Closure safety guard exists; completion snapshot omitted event totals and details | Add authoritative event summary to the existing report |
| Notifications/audit | notification centre/deliveries and audit pages | notifications and append-only audit events | Shared infrastructure exists and is tenant scoped | Reuse; emit one event/notification path per successful sync |

## Material findings fixed in this implementation

1. Shared PDF primitives conflicted with the approved IBM Plex Mono, Allura, red-border and
   government header standard.
2. Trip Authority sections did not follow the approved A–H order and A/B pairing.
3. Trip events lacked an authoritative tenant-scoped number, severity, continuation state,
   injury count and rapid-report completion state.
4. Critical defect events did not automatically restrict the allocated vehicle or open a
   maintenance follow-up.
5. Return inspection did not surface the trip's event history.
6. Trip Completion documents omitted incident, defect, accident and injury totals.
7. Offline `request` drafts were incorrectly submitted to `/api/trip-logs`.
8. Offline inspection sync included a client-controlled tenant ID.
9. The Drizzle migration journal omitted existing migrations 0023 and 0024.
10. The standalone inspection incident endpoint did not verify that the supplied trip belonged
    to the current tenant.

## Data migration risk

Migration `0025_authoritative_trip_incidents.sql` is additive. It introduces nullable detail
columns, safe defaults, a tenant/year sequence table, unique indexes and a deterministic backfill
for historical event numbers. It does not delete or rewrite existing incident descriptions,
attachments or audit history. It was applied first to the isolated Neon branch
`codex-release-0025-20260801`; the migration journal, required columns, sequence table, unique
indexes and zero-missing-number backfill were verified before production deployment.

## Known remaining gaps after this slice

- Offline incident photos/files now persist in IndexedDB and checkpoint uploaded keys between
  retries; storage quotas and server-side checksum deduplication still need device/provider testing.
- Full Motor Vehicle Accident Report and investigation/insurance workflow remain incomplete.
- Vehicle replacement and per-vehicle kilometre separation are not complete end to end.
- Tenant-configurable incident categories and cached emergency contacts are not complete.
- Incident detail completion, technical clearance and investigation closure need dedicated
  permissioned actions rather than direct record editing.
- Existing incident creation is not yet wrapped in one database transaction spanning the event,
  defect, vehicle restriction, maintenance record, notifications and audit event.
These items are operationally significant; the application must not be labelled fully production
ready against the master brief until they are completed and tested.
