import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const inspectionSource = readFileSync(resolve(process.cwd(), 'src/lib/inspection-service.ts'), 'utf8');
const closeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/close/route.ts'),
  'utf8',
);

describe('trip return-to-service and closure safety contract', () => {
  it('turns critical return-inspection failures into blocking defects and maintenance state', () => {
    expect(inspectionSource).toContain("const status = criticalFailure ? 'failed' : 'completed';");
    expect(inspectionSource).toContain("severity: item.isCritical ? 'critical' : 'major'");
    expect(inspectionSource).toContain('isBlocking: item.isCritical');
    expect(inspectionSource).toContain("ELSE 'maintenance'");
    expect(inspectionSource).toContain('Critical ${input.type} inspection defect follow-up');
  });

  it('allows reconciliation of a submitted failed return inspection without making the vehicle available', () => {
    expect(closeSource).toContain("!['completed', 'failed'].includes(arrivalInspection.status)");
    expect(closeSource).toContain("const resultingVehicleStatus = blockingDefect\n      ? 'maintenance'");
    expect(closeSource).toContain("when exists (\n        select 1\n        from ${vehicleDefects} vd");
    expect(closeSource).toContain("then 'maintenance'");
    expect(closeSource).toContain('Trip closed with unresolved blocking defect');
  });

  it('preserves existing restricted vehicle states during trip closure', () => {
    expect(closeSource).toContain("const RESTRICTED_VEHICLE_STATUSES = new Set(['maintenance', 'out_of_service', 'written_off']);");
    expect(closeSource).toContain('RESTRICTED_VEHICLE_STATUSES.has(currentVehicle.status)');
    expect(closeSource).toContain("when ${vehicles.status} in ('maintenance', 'out_of_service', 'written_off') then ${vehicles.status}");
  });

  it('blocks closure while financial reconciliation remains unverified', () => {
    expect(closeSource).toContain('eq(fuelTransactions.isVerified, false)');
    expect(closeSource).toContain("ne(tripExpenses.verificationStatus, 'verified')");
    expect(closeSource).toContain('All fuel and expense transactions must be verified before closure');
  });

  it('blocks unsafe incidents until resolution and technical clearance are both complete', () => {
    expect(closeSource).toContain("ne(tripIncidents.status, 'resolved')");
    expect(closeSource).toContain("ne(tripIncidents.technicalClearanceStatus, 'cleared')");
    expect(closeSource).toContain('A vehicle-safety incident remains unresolved or still requires technical clearance.');
    expect(closeSource).toContain("ELSE 'trip_closure_lifecycle_conflict'");
  });

  it('requires return declarations and receipt evidence to be reconciled before closure', () => {
    expect(closeSource).toContain('Return declarations must be reconciled before this trip can be closed.');
    expect(closeSource).toContain('An incident was declared at return, but no incident record exists for this trip.');
    expect(closeSource).toContain('Outstanding receipts were declared at return, but no receipt evidence exists for this trip.');
  });
});
