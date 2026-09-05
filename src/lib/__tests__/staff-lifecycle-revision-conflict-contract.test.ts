import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/employees/[id]/lifecycle/route.ts'),
  'utf8',
);

describe('staff lifecycle revision conflict contract', () => {
  it('matches the reviewed employee updatedAt revision before lifecycle side effects', () => {
    const helper = source.indexOf('async function updateEmployeeRevision');
    const revision = source.indexOf('eq(employees.updatedAt, employee.updatedAt)', helper);
    const conflict = source.indexOf('throw new EmployeeLifecycleConflictError()', helper);

    expect(helper).toBeGreaterThan(-1);
    expect(revision).toBeGreaterThan(helper);
    expect(conflict).toBeGreaterThan(revision);
  });

  it('claims the employee revision before dependent availability and assignment writes', () => {
    const availability = source.indexOf("body.action === 'availability'");
    const availabilityClaim = source.indexOf('await updateEmployeeRevision(tx, employee', availability);
    const closeAvailability = source.indexOf('.update(employeeAvailability)', availability);
    const transfer = source.indexOf("body.action === 'transfer'");
    const transferClaim = source.indexOf('await updateEmployeeRevision(tx, employee', transfer);
    const closeAssignment = source.indexOf('.update(employeeAssignments)', transfer);

    expect(availabilityClaim).toBeGreaterThan(availability);
    expect(availabilityClaim).toBeLessThan(closeAvailability);
    expect(transferClaim).toBeGreaterThan(transfer);
    expect(transferClaim).toBeLessThan(closeAssignment);
  });

  it('keeps status and driver changes in the same transaction after the revision claim', () => {
    const status = source.indexOf("body.action === 'status'");
    const transaction = source.indexOf('await db.transaction(async (tx) => {', status);
    const claim = source.indexOf('await updateEmployeeRevision(tx, employee', transaction);
    const driverUpdate = source.indexOf('.update(driverProfiles)', claim);

    expect(transaction).toBeGreaterThan(status);
    expect(claim).toBeGreaterThan(transaction);
    expect(driverUpdate).toBeGreaterThan(claim);
  });

  it('returns a controlled 409 before audit when a lifecycle revision claim is lost', () => {
    const catchBlock = source.indexOf('error instanceof EmployeeLifecycleConflictError');
    const conflictMessage = source.indexOf('This employee lifecycle record changed while the action was being prepared', catchBlock);
    const audit = source.indexOf('await recordAuditEvent({', catchBlock);

    expect(catchBlock).toBeGreaterThan(-1);
    expect(conflictMessage).toBeGreaterThan(catchBlock);
    expect(audit).toBeGreaterThan(conflictMessage);
  });

  it('deletes only the exact reviewed revision and audits only after a winning delete', () => {
    const deleteHandler = source.indexOf('export async function DELETE');
    const revision = source.indexOf('eq(employees.updatedAt, employee.updatedAt)', deleteHandler);
    const returning = source.indexOf('.returning({ id: employees.id })', revision);
    const lostClaim = source.indexOf('if (deleted.length === 0)', returning);
    const audit = source.indexOf('await recordAuditEvent({', lostClaim);

    expect(revision).toBeGreaterThan(deleteHandler);
    expect(returning).toBeGreaterThan(revision);
    expect(lostClaim).toBeGreaterThan(returning);
    expect(audit).toBeGreaterThan(lostClaim);
  });
});
