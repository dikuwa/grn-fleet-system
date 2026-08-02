# Workspace authorization hardening

Implemented 2 August 2026.

## Architecture

- `src/lib/workspaces.ts` is the canonical workspace registry and active-workspace resolver.
- `src/lib/dashboard-access.ts` is the canonical route/capability registry. Sidebar, direct URL guards, notification deep links, and dashboard quick links use it.
- `src/lib/record-scope.ts` supplies reusable request, trip, fuel, inspection, vehicle, maintenance, defect, and document SQL scope conditions.
- `src/lib/notification-service.ts` resolves explicit recipients, validates active dated role assignments, produces recipient-specific rows, and generates stable deduplication keys.
- `tenant_memberships.active_workspace` persists the selected workspace. Eligibility is recalculated from current active role assignments on every resolution; stored state never grants access.

## Workspace boundaries

| Workspace | Operational scope |
| --- | --- |
| Personal Requester | Own, entered-on-behalf, and participant requests |
| Approver | Current assignments; acted-on items are separated into history |
| Driver | Main/additional assigned trips, their logs, fuel, documents, and related vehicles |
| Inspector | Assigned/own inspections, related defects, and limited vehicle lookup |
| Maintenance | Assigned work and defects, related vehicles and history |
| Transport Administration | Tenant-wide transport operations |
| Tenant Administration | People, organisation, workflows, configuration, delivery, reports, and audit; no transport execution |
| Audit | Tenant-wide read-only registers and exceptions |
| Platform Administration | Platform routes only; tenant operational routes remain denied |

Every non-platform tenant workspace retains New Transport Request, My Requests, Notifications, Profile, and Dashboard. A multi-role user has multiple eligible workspaces but only one active authorization context; permissions are not unioned.

## Notifications

- New operational notifications use one row per accountable recipient.
- Identity is recipient + event type + entity + workflow stage + event version.
- Action-required notifications are mandatory until resolved; clear-all preserves them.
- Feeds are filtered by tenant, recipient, active workspace, and lifecycle status.
- Legacy tenant/role/department/office/tenant-admin broadcasts are archived as activity evidence by migration and an audit event records the count.
- Generic tenant-wide notification creation is rejected.

## Database migrations

- `0026_active_workspace.sql`: active workspace persistence.
- `0027_notification_scope_lifecycle.sql`: recipient identity, workspace, dedupe, lifecycle, indexes, and legacy-feed migration.
- `0028_assigned_maintenance_scope.sql`: explicit maintenance/defect assignments and indexes.

## Verification

- Route policy tests cover all workspace types, common self-service access, tenant/platform separation, read-only audit, route deduplication, and multi-role non-union.
- Notification policy tests cover explicit recipient deduplication and recipient/stage-specific event identity.
- E2E role-route expectations cover every seeded role, and the legacy broadcast test now verifies tenant-wide notifications are rejected.
- TypeScript and changed-file ESLint checks pass.

## Operational note

Platform tenant support remains restricted to the existing explicit platform tenant views. Tenant operational routes are not enabled for platform administrators, so support access cannot silently bypass workspace isolation.
