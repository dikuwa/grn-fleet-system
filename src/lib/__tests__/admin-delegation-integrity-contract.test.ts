import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/admin/users/[id]/delegate/route.ts'),
  'utf8',
);

describe('admin delegation integrity contract', () => {
  it('validates role UUID after request/date validation but before UUID-backed role lookup', () => {
    const dates = source.indexOf("Delegation end date must be after its start date");
    const guard = source.indexOf('if (!UUID_PATTERN.test(roleId))');
    const roleQuery = source.indexOf('eq(roles.id, roleId)', guard);

    expect(dates).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(dates);
    expect(roleQuery).toBeGreaterThan(guard);
  });

  it('returns the existing acting-assignment 404 for malformed assignment IDs before database access', () => {
    const required = source.indexOf('assignmentId query param is required');
    const guard = source.indexOf('if (!UUID_PATTERN.test(assignmentId))');
    const notFound = source.indexOf("Acting assignment not found", guard);
    const lookup = source.indexOf('eq(roleAssignments.id, assignmentId)', guard);

    expect(guard).toBeGreaterThan(required);
    expect(notFound).toBeGreaterThan(guard);
    expect(lookup).toBeGreaterThan(notFound);
  });

  it('claims the reviewed assignment end-date revision before audit success', () => {
    const deleteHandler = source.indexOf('export async function DELETE');
    const transaction = source.indexOf('const committed = await db.transaction', deleteHandler);
    const revision = source.indexOf('assignmentEndRevisionMatches(assignment.endDate)', transaction);
    const returning = source.indexOf('.returning({ id: roleAssignments.id })', revision);
    const noWin = source.indexOf('if (!ended) return false', returning);
    const audit = source.indexOf('await recordAuditEvent({', noWin);

    expect(transaction).toBeGreaterThan(deleteHandler);
    expect(revision).toBeGreaterThan(transaction);
    expect(returning).toBeGreaterThan(revision);
    expect(noWin).toBeGreaterThan(returning);
    expect(audit).toBeGreaterThan(noWin);
  });

  it('maps a lost end-date claim to controlled 409 after the transaction', () => {
    const committed = source.indexOf('if (!committed)');
    const conflict = source.indexOf('This acting assignment changed while the end action was being prepared', committed);
    const status = source.indexOf('{ status: 409 }', conflict);

    expect(committed).toBeGreaterThan(-1);
    expect(conflict).toBeGreaterThan(committed);
    expect(status).toBeGreaterThan(conflict);
  });
});
