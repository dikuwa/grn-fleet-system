import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { importBatches, importRows } from '@/db/schema/notifications';
import { employees, departments, offices } from '@/db/schema/people';
import { eq, sql } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

interface ImportRowData {
  employee_number: string;
  title?: string;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  job_title?: string;
  department?: string;
  office?: string;
  employment_status?: string;
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    // Authenticate and authorise
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permCheck = await requirePermission(session, Permissions.STAFF_IMPORT);
    if (permCheck instanceof NextResponse) return permCheck;

    const userId = session.user.id;
    const tenantId = session.tenantId;

    const { rows } = body as {
      rows: ImportRowData[];
    };

    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: 'No rows to import' }, { status: 400 });
    }

    // Create import batch
    const [batch] = await db
      .insert(importBatches)
      .values({
        tenantId,
        importType: 'employee',
        fileName: 'CSV Import',
        fileKey: '',
        status: 'validated',
        totalRows: rows.length,
        validRows: 0,
        errorRows: 0,
        importedByUserId: userId,
      })
      .returning();

    let validCount = 0;
    let errorCount = 0;

    // Process each row
    for (const row of rows) {
      try {
        // Resolve department
        let departmentId: string | null = null;
        if (row.department) {
          const [dept] = await db
            .select({ id: departments.id })
            .from(departments)
            .where(eq(departments.name, row.department))
            .limit(1);
          if (dept) departmentId = dept.id;
        }

        // Resolve office
        let officeId: string | null = null;
        if (row.office) {
          const [office] = await db
            .select({ id: offices.id })
            .from(offices)
            .where(eq(offices.name, row.office))
            .limit(1);
          if (office) officeId = office.id;
        }

        // Check for duplicate employee number
        const [existing] = await db
          .select({ id: employees.id })
          .from(employees)
          .where(eq(employees.employeeNumber, row.employee_number))
          .limit(1);

        if (existing) {
          // Update existing
          await db
            .update(employees)
            .set({
              title: row.title || null,
              firstName: row.first_name,
              lastName: row.last_name,
              email: row.email || null,
              phone: row.phone || null,
              jobTitle: row.job_title || null,
              departmentId,
              officeId,
              employmentStatus: row.employment_status || 'active',
            })
            .where(eq(employees.id, existing.id));

          await db.insert(importRows).values({
            batchId: batch.id,
            rowNumber: validCount + errorCount + 1,
            rawData: row as unknown as Record<string, unknown>,
            isCommitted: true,
            commitEntityId: existing.id,
          });
        } else {
          // Insert new employee
          const [employee] = await db
            .insert(employees)
            .values({
              tenantId,
              employeeNumber: row.employee_number,
              title: row.title || null,
              firstName: row.first_name,
              lastName: row.last_name,
              email: row.email || null,
              phone: row.phone || null,
              jobTitle: row.job_title || null,
              departmentId,
              officeId,
              employmentStatus: row.employment_status || 'active',
            })
            .returning();

          await db.insert(importRows).values({
            batchId: batch.id,
            rowNumber: validCount + errorCount + 1,
            rawData: row as unknown as Record<string, unknown>,
            isCommitted: true,
            commitEntityId: employee.id,
          });
        }

        validCount++;
      } catch (rowError) {
        errorCount++;
        await db.insert(importRows).values({
          batchId: batch.id,
          rowNumber: validCount + errorCount,
          rawData: row as unknown as Record<string, unknown>,
          validationErrors: [String(rowError)],
          isCommitted: false,
        });
      }
    }

    // Update batch status
    const batchStatus =
      errorCount > 0 && validCount > 0
        ? 'partially_committed'
        : errorCount > 0
          ? 'failed'
          : 'committed';
    await db
      .update(importBatches)
      .set({
        status: batchStatus,
        validRows: validCount,
        errorRows: errorCount,
        committedRows: validCount,
        committedAt: sql`now()`,
      })
      .where(eq(importBatches.id, batch.id));

    return NextResponse.json({
      success: true,
      batchId: batch.id,
      validRows: validCount,
      errorRows: errorCount,
    });
  } catch (error) {
    console.error('Import failed:', error);
    return NextResponse.json(
      { error: 'Import failed: ' + String(error) },
      { status: 500 },
    );
  }
}
