import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('inspection schedule and date controls', () => {
  it('derives pending inspection schedule from authoritative allocation windows with tenant scoping', () => {
    const schedule = source('src/lib/inspection-schedule.ts');

    expect(schedule).toContain('vehicleAllocations.startAt');
    expect(schedule).toContain('vehicleAllocations.endAt');
    expect(schedule).toContain("inArray(vehicleAllocations.state, ['provisional', 'confirmed'])");
    expect(schedule).toContain('eq(transportRequests.tenantId, tenantId)');
    expect(schedule).toContain('eq(vehicles.tenantId, tenantId)');
    expect(schedule).toContain('eq(trips.tenantId, tenantId)');
    expect(schedule).toContain('eq(vehicleInspections.tenantId, tenantId)');
    expect(schedule).toContain('overallPass: vehicleInspections.overallPass');
    expect(schedule).toContain("row.type === 'departure' && row.overallPass !== true");
    expect(schedule).toContain("satisfied.has(`${row.tripId}:departure`)");
    expect(schedule).toContain("satisfied.has(`${row.tripId}:return`)");
    expect(schedule).not.toContain('vehicleInspections.createdAt');
  });

  it('keeps failed departure work pending for lifecycle-required re-inspection', () => {
    const schedule = source('src/lib/inspection-schedule.ts');
    const service = source('src/lib/inspection-service.ts');

    expect(service).toContain(".set({ status: 'awaiting_pre_trip_inspection', updatedAt: now })");
    expect(service).toContain('if (overallPass)');
    expect(service).toContain(".set({ status: 'ready_for_departure'");
    expect(schedule).toContain("if (row.type === 'departure' && row.overallPass !== true) return [];");
  });

  it('surfaces the derived schedule only for the tenant-manage inspection surface', () => {
    const layout = source('src/app/(dashboard)/dashboard/inspections/layout.tsx');
    const panel = source('src/components/inspections/inspection-schedule-panel.tsx');

    expect(layout).toContain("resolveDashboardAccess('/dashboard/inspections', roleNames)");
    expect(layout).toContain("routeAccess.accessMode === 'tenant_manage'");
    expect(layout).toContain('getPendingInspectionSchedule(session.tenantId)');
    expect(panel).toContain("pathname !== '/dashboard/inspections'");
    expect(panel).toContain('Inspection Schedule');
    expect(panel).toContain('Approved');
    expect(panel).toContain('event.isOverdue');
  });

  it('orders eligible work and renders the corresponding departure or return due time', () => {
    const context = source('src/app/api/inspections/context/route.ts');
    const form = source('src/app/(dashboard)/dashboard/inspections/new/page.tsx');

    expect(context).toContain(
      "asc(type === 'departure' ? vehicleAllocations.startAt : vehicleAllocations.endAt)",
    );
    expect(context).toContain(
      "scheduledAt: type === 'departure' ? trip.departureAt : trip.returnAt",
    );
    expect(context).toContain('eq(transportRequests.tenantId, session.tenantId)');
    expect(context).toContain('eq(vehicles.tenantId, session.tenantId)');
    expect(context).toContain('eq(tripAuthorities.tenantId, session.tenantId)');
    expect(form).toContain('scheduledAt: string;');
    expect(form).toContain('new Date(selectedTrip.scheduledAt)');
    expect(form).not.toContain('new Date(selectedTrip.departureAt)');
  });
});
