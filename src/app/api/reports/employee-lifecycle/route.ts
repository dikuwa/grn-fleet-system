import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import {
  driverLicences,
  driverProfiles,
  employees,
  roleDelegations,
  transportRequests,
  userProfiles,
} from '@/db/schema';
import { and, count, eq, sql } from 'drizzle-orm';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

export async function GET(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const permission = await requirePermission(auth.session, Permissions.REPORT_VIEW);
  if (permission instanceof NextResponse) return permission;
  const db = getDb();
  const tenantId = auth.session.tenantId;
  const [employeeStatuses, availability, accountSummary, delegations, driverCompliance, submissionMethods] = await Promise.all([
    db.select({ status: employees.employmentStatus, count: count() }).from(employees).where(eq(employees.tenantId, tenantId)).groupBy(employees.employmentStatus),
    db.select({ status: employees.availabilityStatus, count: count() }).from(employees).where(eq(employees.tenantId, tenantId)).groupBy(employees.availabilityStatus),
    db.select({
      accountStatus: sql<string>`CASE WHEN ${employees.userId} IS NULL THEN 'no_account' ELSE COALESCE(${userProfiles.status}, 'unconfigured') END`,
      count: count(),
    }).from(employees).leftJoin(userProfiles, eq(userProfiles.userId, employees.userId)).where(eq(employees.tenantId, tenantId))
      .groupBy(sql`CASE WHEN ${employees.userId} IS NULL THEN 'no_account' ELSE COALESCE(${userProfiles.status}, 'unconfigured') END`),
    db.select({ status: roleDelegations.status, count: count() }).from(roleDelegations).where(eq(roleDelegations.tenantId, tenantId)).groupBy(roleDelegations.status),
    db.select({
      status: sql<string>`CASE
        WHEN ${driverLicences.id} IS NULL THEN 'missing'
        WHEN ${driverLicences.verificationStatus} <> 'verified' THEN ${driverLicences.verificationStatus}
        WHEN ${driverLicences.expiryDate} < CURRENT_DATE THEN 'expired'
        WHEN ${driverLicences.expiryDate} <= CURRENT_DATE + INTERVAL '90 days' THEN 'expiring_soon'
        ELSE 'eligible'
      END`,
      count: count(),
    }).from(driverProfiles)
      .innerJoin(employees, eq(employees.id, driverProfiles.employeeId))
      .leftJoin(driverLicences, and(eq(driverLicences.driverProfileId, driverProfiles.id), eq(driverLicences.isActive, true)))
      .where(eq(employees.tenantId, tenantId))
      .groupBy(sql`CASE
        WHEN ${driverLicences.id} IS NULL THEN 'missing'
        WHEN ${driverLicences.verificationStatus} <> 'verified' THEN ${driverLicences.verificationStatus}
        WHEN ${driverLicences.expiryDate} < CURRENT_DATE THEN 'expired'
        WHEN ${driverLicences.expiryDate} <= CURRENT_DATE + INTERVAL '90 days' THEN 'expiring_soon'
        ELSE 'eligible'
      END`),
    db.select({ submissionMethod: transportRequests.submissionMethod, count: count() }).from(transportRequests)
      .where(eq(transportRequests.tenantId, tenantId)).groupBy(transportRequests.submissionMethod),
  ]);
  const data = { employeeStatuses, availability, accountSummary, delegations, driverCompliance, submissionMethods };
  const format = request.nextUrl.searchParams.get('export');
  if (!format) return NextResponse.json({ success: true, data });
  const rows = [
    ...employeeStatuses.map((item) => ({ category: 'Employee status', value: item.status, count: item.count })),
    ...availability.map((item) => ({ category: 'Availability', value: item.status, count: item.count })),
    ...accountSummary.map((item) => ({ category: 'Account', value: item.accountStatus, count: item.count })),
    ...delegations.map((item) => ({ category: 'Delegation', value: item.status, count: item.count })),
    ...driverCompliance.map((item) => ({ category: 'Driver compliance', value: item.status, count: item.count })),
    ...submissionMethods.map((item) => ({ category: 'Request method', value: item.submissionMethod, count: item.count })),
  ];
  if (format === 'csv') {
    const csv = ['Category,Value,Count', ...rows.map((row) => [row.category, row.value, row.count].map((value) => JSON.stringify(String(value))).join(','))].join('\n');
    return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="employee-lifecycle-report.csv"' } });
  }
  if (format === 'excel') {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.default.Workbook();
    const sheet = workbook.addWorksheet('Employee lifecycle');
    sheet.columns = [{ header: 'Category', key: 'category', width: 24 }, { header: 'Value', key: 'value', width: 28 }, { header: 'Count', key: 'count', width: 12 }];
    rows.forEach((row) => sheet.addRow(row));
    sheet.getRow(1).font = { bold: true };
    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(new Uint8Array(buffer as ArrayBuffer) as unknown as BodyInit, {
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="employee-lifecycle-report.xlsx"' },
    });
  }
  return NextResponse.json({ error: 'Supported export formats are csv and excel.' }, { status: 400 });
}
