import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(resolve(process.cwd(), 'src/app/api/expenses/route.ts'), 'utf8');

describe('operational expense trip lifecycle concurrency contract', () => {
  it('claims current trip state before expense and audit inserts', () => {
    const atomicStart = routeSource.indexOf('await runAtomicMutations((executor) => {');
    const guard = routeSource.indexOf("ELSE 'operational_expense_trip_lifecycle_conflict'", atomicStart);
    const expenseInsert = routeSource.indexOf('executor.insert(operationalExpenses).values({', guard);
    const auditInsert = routeSource.indexOf('executor.insert(auditEvents).values({', expenseInsert);

    expect(atomicStart).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(atomicStart);
    expect(expenseInsert).toBeGreaterThan(guard);
    expect(auditInsert).toBeGreaterThan(expenseInsert);
  });

  it('locks the trip and rejects stale vehicle, lifecycle, or driver assignment', () => {
    expect(routeSource).toContain('FOR UPDATE OF t');
    expect(routeSource).toContain('t.vehicle_id = ${vehicleId}::uuid');
    expect(routeSource).toContain("(${permission.canManage}::boolean AND t.status <> 'closed')");
    expect(routeSource).toContain("t.status IN ('in_progress', 'return_due')");
    expect(routeSource).toContain('FROM vehicle_allocations va');
    expect(routeSource).toContain('FROM request_drivers rd');
    expect(routeSource).toContain("rd.driver_type IN ('assigned', 'additional')");
  });

  it('maps a lost race to controlled 409 recovery', () => {
    expect(routeSource).toContain("String(error).includes('operational_expense_trip_lifecycle_conflict')");
    expect(routeSource).toContain('{ status: 409 }');
  });
});
