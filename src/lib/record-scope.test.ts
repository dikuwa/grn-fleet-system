import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { maintenanceScopeCondition, vehicleScopeCondition } from '@/lib/record-scope';

const dialect = new PgDialect();

function renderMaintenanceScope(recordScope: 'tenant' | 'assigned' | 'self' | 'related') {
  return dialect
    .sqlToQuery(
      maintenanceScopeCondition({
        tenantId: '11111111-1111-1111-1111-111111111111',
        userId: 'maintenance-user',
        recordScope,
      }),
    )
    .sql.toLowerCase()
    .replaceAll('"', '');
}

function renderVehicleScope(recordScope: 'tenant' | 'assigned' | 'self' | 'related') {
  return dialect
    .sqlToQuery(
      vehicleScopeCondition({
        tenantId: '11111111-1111-1111-1111-111111111111',
        userId: 'inspector-user',
        recordScope,
      }),
    )
    .sql.toLowerCase()
    .replaceAll('"', '');
}

describe('maintenance record scope', () => {
  it('surfaces unassigned maintenance follow-ups in the assigned Maintenance queue', () => {
    const sql = renderMaintenanceScope('assigned');

    expect(sql).toContain('maintenance_events.assigned_to_user_id is null');
    expect(sql).toContain('maintenance_events.assigned_to_user_id');
    expect(sql).toContain('maintenance_events.created_by_user_id');
  });

  it('does not broaden stricter non-assigned scopes to every unassigned maintenance row', () => {
    expect(renderMaintenanceScope('self')).not.toContain('assigned_to_user_id is null');
    expect(renderMaintenanceScope('related')).not.toContain('assigned_to_user_id is null');
  });
});

describe('inspector vehicle scope', () => {
  it('includes lifecycle-eligible departure and return vehicles before the first inspection exists', () => {
    const sql = renderVehicleScope('assigned');

    expect(sql).toContain("pending_allocation.state = 'confirmed'");
    expect(sql).toContain("pending_trip.status = 'pending'");
    expect(sql).toContain("pending_authority.status in ('driver_accepted', 'awaiting_pre_trip_inspection')");
    expect(sql).toContain("pending_trip.status in ('in_progress', 'return_due', 'return_inspection')");
    expect(sql).toContain("pending_authority.status in ('returned', 'awaiting_arrival_inspection')");
    expect(sql).toContain('departure_external.allocation_id = pending_trip.allocation_id');
    expect(sql).toContain("departure_external.state = 'accepted'");
    expect(sql).toContain('return_external.allocation_id = pending_trip.allocation_id');
    expect(sql).toContain('return_external.issue_id is not null');
  });

  it('keeps the inspection-queue expansion out of maintenance related scope', () => {
    const sql = renderVehicleScope('related');

    expect(sql).not.toContain('pending_authority.status');
    expect(sql).not.toContain('departure_external.state');
  });
});
