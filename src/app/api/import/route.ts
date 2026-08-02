import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { importBatches, importRows } from '@/db/schema/notifications';
import { departments, driverProfiles, employeeAssignments, employees, offices } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { allocateEmployeeNumber } from '@/lib/employee-number';
import { recordAuditEvent } from '@/lib/audit-event';
import { normaliseEmployeeStatus } from '@/lib/employee-status';

interface ImportRowData {
  employee_number?: string;
  title?: string;
  first_name?: string;
  middle_names?: string;
  last_name?: string;
  gender?: string;
  job_title?: string;
  job_grade?: string;
  department?: string;
  office?: string;
  email?: string;
  phone?: string;
  employment_status?: string;
  is_driver?: string | boolean | number;
}

interface PreparedRow {
  source: ImportRowData;
  rowNumber: number;
  employeeNumber: string | null;
  departmentId: string | null;
  officeId: string | null;
  employmentStatus: string;
  isDriver: boolean;
  errors: string[];
}


function normaliseLookup(value: string) {
  return value.trim().toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseBoolean(value: ImportRowData['is_driver']) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const normalised = String(value ?? '').trim().toLowerCase();
  if (!normalised) return false;
  if (['true', 'yes', '1'].includes(normalised)) return true;
  if (['false', 'no', '0'].includes(normalised)) return false;
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const permission = await requirePermission(auth.session, Permissions.STAFF_IMPORT);
    if (permission instanceof NextResponse) return permission;

    const body = await request.json() as {
      rows?: ImportRowData[];
      fileName?: string;
      columnMapping?: Record<string, string>;
      entityMapping?: { department?: Record<string, string>; office?: Record<string, string> };
      reviewedSkippedRows?: number;
    };
    const rows = body.rows ?? [];
    if (rows.length === 0) return NextResponse.json({ error: 'No rows to import.' }, { status: 400 });
    if (rows.length > 10_000) return NextResponse.json({ error: 'Imports are limited to 10,000 rows.' }, { status: 400 });

    const db = getDb();
    const tenantId = auth.session.tenantId;
    const [tenantDepartments, tenantOffices, tenantEmployees] = await Promise.all([
      db.select({ id: departments.id, name: departments.name }).from(departments)
        .where(and(eq(departments.tenantId, tenantId), eq(departments.isActive, true))),
      db.select({ id: offices.id, name: offices.name }).from(offices)
        .where(and(eq(offices.tenantId, tenantId), eq(offices.isActive, true))),
      db.select({ id: employees.id, employeeNumber: employees.employeeNumber, email: employees.email, userId: employees.userId, firstName: employees.firstName, lastName: employees.lastName, phone: employees.phone })
        .from(employees).where(eq(employees.tenantId, tenantId)),
    ]);

    const departmentMap = new Map(tenantDepartments.map((item) => [normaliseLookup(item.name), item.id]));
    const officeMap = new Map(tenantOffices.map((item) => [normaliseLookup(item.name), item.id]));
    const existingNumbers = new Set(tenantEmployees.map((item) => item.employeeNumber.toLowerCase()));
    const existingEmails = new Set(tenantEmployees.flatMap((item) => item.email && item.userId ? [item.email.toLowerCase()] : []));
    const existingPeople = new Set(tenantEmployees.map((item) => normaliseLookup(`${item.firstName} ${item.lastName} ${item.phone || ''}`)));
    const seenNumbers = new Set<string>();
    const seenPeople = new Set<string>();

    const prepared: PreparedRow[] = rows.map((source, index) => {
      const errors: string[] = [];
      const employeeNumber = source.employee_number?.trim() || null;
      const firstName = source.first_name?.trim() || '';
      const lastName = source.last_name?.trim() || '';
      const email = source.email?.trim().toLowerCase() || '';
      const phone = source.phone?.trim() || '';
      if (!firstName) errors.push('First name is required.');
      if (!lastName) errors.push('Last name is required.');
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Email address is invalid.');
      if (email && existingEmails.has(email)) errors.push(`Email ${email} is already used by a tenant login account.`);

      if (employeeNumber) {
        const key = employeeNumber.toLowerCase();
        if (seenNumbers.has(key)) errors.push(`Employee number ${employeeNumber} appears more than once in this file.`);
        if (existingNumbers.has(key)) errors.push(`Employee number ${employeeNumber} is already assigned in this tenant.`);
        seenNumbers.add(key);
      }
      const personKey = normaliseLookup(`${firstName} ${lastName} ${phone}`);
      if (firstName && lastName && seenPeople.has(personKey)) errors.push('Possible duplicate person in this file (same name and phone).');
      if (firstName && lastName && existingPeople.has(personKey)) errors.push('Possible existing staff match in this tenant (same name and phone).');
      if (firstName && lastName) seenPeople.add(personKey);

      const departmentName = source.department?.trim();
      const officeName = source.office?.trim();
      const departmentId = departmentName ? departmentMap.get(normaliseLookup(departmentName)) ?? null : null;
      const officeId = officeName ? officeMap.get(normaliseLookup(officeName)) ?? null : null;
      if (departmentName && !departmentId) errors.push(`Unknown department “${departmentName}”. Map it to an existing tenant department before importing.`);
      if (officeName && !officeId) errors.push(`Unknown office “${officeName}”. Map it to an existing tenant office before importing.`);

      // Employment status defaults to ACTIVE and normalises case variants
      // (ACTIVE / Active / active) plus legacy values to canonical values.
      const status = normaliseEmployeeStatus(source.employment_status?.trim() || 'active');
      if (!status) errors.push(`Unsupported employment status “${source.employment_status}”.`);
      const isDriver = parseBoolean(source.is_driver);
      if (isDriver === null) errors.push(`Unsupported is_driver value “${String(source.is_driver)}”.`);

      return {
        source, rowNumber: index + 2, employeeNumber, departmentId, officeId,
        employmentStatus: status ?? 'active', isDriver: isDriver ?? false, errors,
      };
    });

    const invalid = prepared.filter((row) => row.errors.length > 0);
    if (invalid.length > 0) {
      return NextResponse.json({
        error: 'Import validation failed. No records were created.',
        rowErrors: invalid.map((row) => ({ rowNumber: row.rowNumber, errors: row.errors })),
      }, { status: 422 });
    }

    const result = await db.transaction(async (tx) => {
      const [batch] = await tx.insert(importBatches).values({
        tenantId,
        importType: 'staff',
        fileName: body.fileName?.trim() || 'Staff import',
        fileKey: '',
        columnMapping: body.columnMapping ?? null,
        status: 'validated',
        totalRows: prepared.length,
        validRows: prepared.length,
        errorRows: 0,
        importedByUserId: auth.session.user.id,
      }).returning();

      const createdIds: string[] = [];
      let generatedNumbers = 0;
      let driversCreated = 0;
      const generatedEmployees: Array<{ id: string; employeeNumber: string }> = [];
      const driverEmployees: Array<{ id: string; name: string }> = [];
      for (const row of prepared) {
        const employeeNumber = row.employeeNumber || await allocateEmployeeNumber(tx, tenantId);
        if (!row.employeeNumber) generatedNumbers++;
        const source = row.source;
        const [employee] = await tx.insert(employees).values({
          tenantId,
          employeeNumber,
          title: source.title?.trim() || null,
          firstName: source.first_name!.trim(),
          middleName: source.middle_names?.trim() || null,
          lastName: source.last_name!.trim(),
          gender: source.gender?.trim() || null,
          jobTitle: source.job_title?.trim() || null,
          grade: source.job_grade?.trim() || null,
          departmentId: row.departmentId,
          officeId: row.officeId,
          email: source.email?.trim().toLowerCase() || null,
          phone: source.phone?.trim() || null,
          employmentStatus: row.employmentStatus,
          availabilityStatus: 'available',
          isDriver: row.isDriver,
          archivedAt: row.employmentStatus === 'archived' ? new Date() : null,
        }).returning();

        await tx.insert(employeeAssignments).values({
          tenantId,
          employeeId: employee.id,
          officeId: row.officeId,
          departmentId: row.departmentId,
          jobTitle: source.job_title?.trim() || null,
          position: source.job_title?.trim() || null,
          startDate: new Date().toISOString().slice(0, 10),
          reason: 'Staff import',
          createdByUserId: auth.session.user.id,
        });
        if (row.isDriver) {
          await tx.insert(driverProfiles).values({
            employeeId: employee.id,
            driverStatus: 'incomplete',
            availabilityStatus: 'unavailable',
          });
          driversCreated++;
          driverEmployees.push({ id: employee.id, name: `${employee.firstName} ${employee.lastName}` });
        }
        if (!row.employeeNumber) generatedEmployees.push({ id: employee.id, employeeNumber });
        await tx.insert(importRows).values({
          batchId: batch.id,
          rowNumber: row.rowNumber,
          rawData: source as Record<string, unknown>,
          normalizedData: { employeeNumber, departmentId: row.departmentId, officeId: row.officeId, isDriver: row.isDriver },
          validationErrors: [],
          isCommitted: true,
          commitEntityId: employee.id,
        });
        createdIds.push(employee.id);
      }
      await tx.update(importBatches).set({
        status: 'committed', committedRows: createdIds.length, committedAt: new Date(), updatedAt: new Date(),
      }).where(and(eq(importBatches.id, batch.id), eq(importBatches.tenantId, tenantId)));
      return { batchId: batch.id, createdIds, generatedNumbers, driversCreated, generatedEmployees, driverEmployees };
    });

    await recordAuditEvent({
      tenantId,
      actorUserId: auth.session.user.id,
      action: 'staff.imported',
      entityType: 'import_batch',
      entityId: result.batchId,
      after: { created: result.createdIds.length, generatedNumbers: result.generatedNumbers, driversCreated: result.driversCreated },
      summary: `Imported ${result.createdIds.length} staff records`,
    });
    if ((body.columnMapping && Object.keys(body.columnMapping).length > 0) || body.entityMapping) {
      await recordAuditEvent({
        tenantId,
        actorUserId: auth.session.user.id,
        action: 'import.mapping-decided',
        entityType: 'import_batch',
        entityId: result.batchId,
        after: { columnMapping: body.columnMapping, entityMapping: body.entityMapping, reviewedSkippedRows: body.reviewedSkippedRows || 0 },
        summary: 'Confirmed staff import column and organisation mapping',
      });
    }
    for (const generated of result.generatedEmployees) {
      await recordAuditEvent({ tenantId, actorUserId: auth.session.user.id, action: 'employee.number-generated', entityType: 'employee', entityId: generated.id, after: { employeeNumber: generated.employeeNumber, importBatchId: result.batchId }, summary: `Generated employee number ${generated.employeeNumber} during staff import` });
    }
    for (const driver of result.driverEmployees) {
      await recordAuditEvent({ tenantId, actorUserId: auth.session.user.id, action: 'driver.profile-created', entityType: 'employee', entityId: driver.id, after: { driverStatus: 'incomplete', importBatchId: result.batchId }, summary: `Created incomplete driver profile for ${driver.name}` });
    }

    return NextResponse.json({
      success: true,
      batchId: result.batchId,
      createdRows: result.createdIds.length,
      generatedNumbers: result.generatedNumbers,
      driversCreated: result.driversCreated,
      skippedRows: body.reviewedSkippedRows || 0,
      failedRows: 0,
    }, { status: 201 });
  } catch (error) {
    console.error('[Staff Import] failed:', error);
    const message = error instanceof Error && /unique|duplicate/i.test(error.message)
      ? 'An employee number or email was claimed concurrently. No records were imported; review the file and retry.'
      : 'The staff import failed. No records were imported.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
