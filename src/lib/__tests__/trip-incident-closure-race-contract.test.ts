import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'src/db/migrations/0104_trip_incident_closure_serialization.sql',
  'utf8',
);
const incidentService = readFileSync('src/lib/incidents/create-incident.ts', 'utf8');
const offlineWindow = readFileSync('src/lib/incidents/offline-incident-window.ts', 'utf8');

describe('late offline incident vs final closure contract', () => {
  it('serializes new incident evidence on the same tenant-scoped trip row used by closure', () => {
    expect(migration).toContain('BEFORE INSERT');
    expect(migration).toContain('ON trip_incidents');
    expect(migration).toContain('WHERE id = NEW.trip_id');
    expect(migration).toContain('AND tenant_id = NEW.tenant_id');
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain('Do not reject closed trips here');
  });

  it('preserves deliberately bounded post-close offline incident recovery', () => {
    expect(offlineWindow).toContain("'return_inspection', 'closure_review', 'closed'");
    expect(offlineWindow).toContain('input.clientSyncId');
    expect(offlineWindow).toContain('input.offlineCreatedAt');
    expect(incidentService).toContain("if (tripStatus === 'closed')");
    expect(incidentService).toContain("documentType: 'trip_completion'");
  });

  it('refreshes serialized trip state before post-incident document side effects', () => {
    expect(incidentService).toContain('const [liveTrip] = await db');
    expect(incidentService).toContain('.select({ status: trips.status })');
    expect(incidentService).toContain('eq(trips.id, input.tripId)');
    expect(incidentService).toContain('eq(trips.tenantId, input.tenantId)');
    expect(incidentService).toContain('liveTrip.status');
    expect(incidentService).not.toContain('maintenanceAssigneeUserId,\n    trip.status,\n    requiresVehicleRestriction');
  });

  it('prevents stale closure-review state from clearing reconciliation after closure', () => {
    expect(migration).toContain('preserve_closed_trip_return_reconciliation');
    expect(migration).toContain("lateIncidentRequiresReconciliation");
    expect(migration).toContain("IF v_trip_status = 'closed' THEN");
    expect(migration).toContain("OLD.data -> 'returnDeclaration'");
  });

  it('keeps immutable audit evidence aligned with the closure-first outcome', () => {
    expect(migration).toContain('correct_closed_late_incident_audit');
    expect(migration).toContain("NEW.event_type <> 'incident_created'");
    expect(migration).toContain("'{returnReconciliationInvalidated}'");
    expect(migration).toContain("'lateIncidentArchivedAfterClosure', true");
  });

  it('keeps incident-first reconciliation invalidation in the existing service path', () => {
    expect(incidentService).toContain("['return_inspection', 'closure_review'].includes(trip.status)");
    expect(incidentService).toContain("'reconciledAt', null");
    expect(incidentService).toContain("'lateIncidentRequiresReconciliation', true");
  });
});
