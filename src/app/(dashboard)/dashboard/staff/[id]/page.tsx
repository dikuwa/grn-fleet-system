import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { isDbConnected, getDb } from '@/db';
import {
  employees,
  departments,
  offices,
  driverProfiles,
  driverLicences,
  employeeDocuments,
} from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import {
  Mail,
  Phone,
  Building2,
  Calendar,
  Car,
  FileText,
  Download,
  ChevronLeft,
  Database,
} from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

interface PageParams {
  id: string;
}

interface EmployeeDetailData {
  employee: NonNullable<Awaited<ReturnType<typeof fetchEmployee>>>;
  driverProfile: NonNullable<Awaited<ReturnType<typeof fetchDriverProfile>>> | null;
  licences: Awaited<ReturnType<typeof fetchLicences>>;
  docs: Awaited<ReturnType<typeof fetchDocs>>;
}

async function fetchEmployee(id: string) {
  const dbo = getDb();
  return dbo
    .select({
      id: employees.id,
      employeeNumber: employees.employeeNumber,
      title: employees.title,
      firstName: employees.firstName,
      lastName: employees.lastName,
      jobTitle: employees.jobTitle,
      email: employees.email,
      phone: employees.phone,
      employmentStatus: employees.employmentStatus,
      isDriver: employees.isDriver,
      departmentId: employees.departmentId,
      departmentName: departments.name,
      officeId: employees.officeId,
      officeName: offices.name,
      grade: employees.grade,
      createdAt: employees.createdAt,
    })
    .from(employees)
    .leftJoin(departments, eq(employees.departmentId, departments.id))
    .leftJoin(offices, eq(employees.officeId, offices.id))
    .where(eq(employees.id, id))
    .limit(1)
    .then((rows) => rows[0] ?? null);
}

async function fetchDriverProfile(employeeId: string) {
  const dbo = getDb();
  return dbo
    .select()
    .from(driverProfiles)
    .where(eq(driverProfiles.employeeId, employeeId))
    .limit(1)
    .then((rows) => rows[0] ?? null);
}

async function fetchLicences(profileId: string) {
  const dbo = getDb();
  return dbo
    .select()
    .from(driverLicences)
    .where(eq(driverLicences.driverProfileId, profileId))
    .orderBy(desc(driverLicences.issueDate));
}

async function fetchDocs(employeeId: string) {
  const dbo = getDb();
  return dbo
    .select()
    .from(employeeDocuments)
    .where(eq(employeeDocuments.employeeId, employeeId))
    .orderBy(desc(employeeDocuments.createdAt));
}

async function fetchEmployeeDetail(id: string): Promise<EmployeeDetailData> {
  const employee = await fetchEmployee(id);
  if (!employee) throw new Error('NOT_FOUND');

  const driverProfile = employee.isDriver ? await fetchDriverProfile(employee.id) : null;
  const licences = driverProfile ? await fetchLicences(driverProfile.id) : [];
  const docs = await fetchDocs(employee.id);

  return { employee, driverProfile, licences, docs };
}

export const dynamic = 'force-dynamic';

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { id } = await params;

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Staff Directory', href: '/dashboard/staff' }, { label: 'Employee Details' }]} />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" description="Database connection is required to view employee details." />
      </div>
    );
  }

  let data: EmployeeDetailData;
  try {
    data = await fetchEmployeeDetail(id);
  } catch (error) {
    if (error instanceof Error && error.message === 'NOT_FOUND') {
      notFound();
    }
    console.error('Employee detail query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Staff Directory', href: '/dashboard/staff' }, { label: 'Error' }]} />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Employee Details" description="The database query failed. This may be due to missing migrations or a connection issue." />
      </div>
    );
  }

  const { employee, driverProfile, licences, docs } = data;
  const statusVariant = employee.employmentStatus === 'active' ? 'success' : employee.employmentStatus === 'suspended' ? 'pending' : 'error';

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Staff Directory', href: '/dashboard/staff' }, { label: `${employee.firstName} ${employee.lastName}` }]} />
      <PageHeader title="Employee Detail" description="View employee information and records">
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/staff"><ChevronLeft className="h-4 w-4" />Back to Directory</Link>
        </Button>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-brand-50 text-2xl font-bold text-brand-800">{employee.firstName.charAt(0)}{employee.lastName.charAt(0)}</div>
              <h2 className="text-lg font-semibold text-ink-950">{employee.title && `${employee.title} `}{employee.firstName} {employee.lastName}</h2>
              <p className="mt-1 text-sm text-ink-500">{employee.jobTitle}</p>
              <div className="mt-3"><StatusBadge status={statusVariant} label={employee.employmentStatus.charAt(0).toUpperCase() + employee.employmentStatus.slice(1)} /></div>
            </div>
            <div className="mt-6 space-y-3 border-t border-border pt-4">
              <div className="flex items-center gap-3 text-sm"><Mail className="h-4 w-4 text-ink-400" /><span className="text-ink-700">{employee.email || '—'}</span></div>
              <div className="flex items-center gap-3 text-sm"><Phone className="h-4 w-4 text-ink-400" /><span className="text-ink-700">{employee.phone || '—'}</span></div>
              <div className="flex items-center gap-3 text-sm"><Building2 className="h-4 w-4 text-ink-400" /><span className="text-ink-700">{employee.departmentName || '—'}</span></div>
              <div className="flex items-center gap-3 text-sm"><Building2 className="h-4 w-4 text-ink-400" /><span className="text-ink-700">{employee.officeName || '—'}</span></div>
              <div className="flex items-center gap-3 text-sm"><Calendar className="h-4 w-4 text-ink-400" /><span className="text-ink-700">Employee # {employee.employeeNumber}</span></div>
              {employee.isDriver && <div className="flex items-center gap-3 text-sm"><Car className="h-4 w-4 text-ink-400" /><StatusBadge status="info" label="Driver" /></div>}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          {driverProfile && (
            <Card>
              <CardHeader><CardTitle>Driver Profile</CardTitle></CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div><p className="text-xs text-ink-500">Driver Status</p><StatusBadge status={driverProfile.driverStatus === 'authorised' ? 'success' : 'error'} label={driverProfile.driverStatus.charAt(0).toUpperCase() + driverProfile.driverStatus.slice(1)} /></div>
                  <div><p className="text-xs text-ink-500">Internal Authorisation</p><p className="text-sm text-ink-700">{driverProfile.internalAuthorisationRef || '—'}</p></div>
                  <div><p className="text-xs text-ink-500">Active Licences</p><p className="text-sm text-ink-700">{licences.length}</p></div>
                </div>
              </CardContent>
            </Card>
          )}

          {licences.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Driver Licences</CardTitle><Badge variant="info">{licences.length} record{licences.length !== 1 ? 's' : ''}</Badge></CardHeader>
              <CardContent>
                <div className="divide-y divide-border">
                  {licences.map((licence) => (
                    <div key={licence.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-ink-950">Class {licence.licenceClass} — {licence.licenceNumber}</p>
                        <p className="text-xs text-ink-500">Issued {licence.issueDate} · Expires {licence.expiryDate}{licence.allowedVehicleCategories && ` · ${licence.allowedVehicleCategories}`}</p>
                      </div>
                      <StatusBadge status={licence.verificationStatus === 'verified' ? 'success' : licence.verificationStatus === 'expired' ? 'error' : 'pending'} label={licence.verificationStatus.charAt(0).toUpperCase() + licence.verificationStatus.slice(1)} />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Documents</CardTitle><Badge variant="default">{docs.length} file{docs.length !== 1 ? 's' : ''}</Badge></CardHeader>
            <CardContent>
              {docs.length === 0 ? (
                <p className="text-sm text-ink-500">No documents have been uploaded for this employee.</p>
              ) : (
                <div className="divide-y divide-border">
                  {docs.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center gap-3">
                        <FileText className="h-5 w-5 text-ink-400" />
                        <div>
                          <p className="text-sm font-medium text-ink-950">{doc.documentName}</p>
                          <p className="text-xs text-ink-500">{doc.documentType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}{doc.expiryDate && ` · Expires ${doc.expiryDate}`}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {doc.isVerified && <StatusBadge status="success" label="Verified" />}
                        <Button variant="ghost" size="icon-sm"><Download className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
