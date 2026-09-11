import { notFound } from 'next/navigation';
import { getServerSession } from '@/lib/session';
import { getSessionRoleNames, requireDashboardAction } from '@/lib/auth-helpers';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { getPendingInspectionSchedule } from '@/lib/inspection-schedule';
import { InspectionSchedulePanel } from '@/components/inspections/inspection-schedule-panel';

export default async function InspectionsLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) notFound();

  const access = await requireDashboardAction(session, '/dashboard/inspections', 'view');
  if (access !== true) notFound();

  const roleNames = await getSessionRoleNames(session);
  const routeAccess = resolveDashboardAccess('/dashboard/inspections', roleNames);
  const schedule =
    routeAccess.accessMode === 'tenant_manage'
      ? await getPendingInspectionSchedule(session.tenantId)
      : [];

  return (
    <div className="space-y-6">
      {routeAccess.accessMode === 'tenant_manage' && (
        <InspectionSchedulePanel events={schedule} />
      )}
      {children}
    </div>
  );
}
