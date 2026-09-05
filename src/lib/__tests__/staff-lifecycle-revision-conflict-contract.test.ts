import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/employees/[id]/lifecycle/route.ts'),
  'utf8',
);

describe('staff lifecycle revision conflict contract', () => {
  it('normalizes the reviewed employee updatedAt revision to JavaScript millisecond precision', () => {
    const matcher = source.indexOf('function employeeRevisionMatches');
    const truncation = source.indexOf("date_trunc('milliseconds'", matcher);
    const reviewed = source.indexOf('employee.updatedAt.toISOString()', truncation);
    const helper = source.indexOf('async function updateEmployeeRevision');
    const revision = source.indexOf('employeeRevisionMatches(employee)', helper);
    const conflict = source.indexOf('throw new EmployeeLifecycleConflictError()', helper);

    expect(matcher).toBeGreaterThan(-1);
    expect(truncation).toBeGreaterThan(matcher);
    expect(reviewed).toBeGreaterThan(truncation);
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
    const transaction = source.indexOf('runLifecycleTransaction(db, async (tx) => {', status);
    const claim = source.indexOf('await updateEmployeeRevision(tx, employee', transaction);
    const driverUpdate = source.indexOf('.update(driverProfiles)', claim);

    expect(transaction).toBeGreaterThan(status);
    expect(claim).toBeGreaterThan(transaction);
    expect(driverUpdate).toBeGreaterThan(claim);
  });

  it('maps a lost revision claim to controlled conflict before successful audit', () => {
    const wrapper = source.indexOf('async function runLifecycleTransaction');
    const catchesConflict = source.indexOf('error instanceof EmployeeLifecycleConflictError', wrapper);
    const response = source.indexOf('if (!committed) return lifecycleConflictResponse();');
    const audit = source.indexOf('await recordAuditEvent({', response);

    expect(wrapper).toBeGreaterThan(-1);
    expect(catchesConflict).toBeGreaterThan(wrapper);
    expect(response).toBeGreaterThan(catchesConflict);
    expect(audit).toBeGreaterThan(response);
  });

  it('deletes only the exact reviewed revision and audits only after a winning delete', () => {
    const deleteHandler = source.indexOf('export async function DELETE');
    const revision = source.indexOf('employeeRevisionMatches(employee)', deleteHandler);
    const returning = source.indexOf('.returning({ id: employees.id })', revision);
    const lostClaim = source.indexOf('if (deleted.length === 0)', returning);
    const audit = source.indexOf('await recordAuditEvent({', lostClaim);

    expect(revision).toBeGreaterThan(deleteHandler);
    expect(returning).toBeGreaterThan(revision);
    expect(lostClaim).toBeGreaterThan(returning);
    expect(audit).toBeGreaterThan(lostClaim);
  });
});
