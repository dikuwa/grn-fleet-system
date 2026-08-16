import type { ReactNode } from 'react';
import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getDb, isDbConnected } from '@/db';
import { vehicles } from '@/db/schema/fleet';
import { getSessionRoleNames } from '@/lib/auth-helpers';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { vehicleScopeCondition } from '@/lib/record-scope';
import { getServerSession } from '@/lib/session';

type VehicleLayoutProps = {
  children: ReactNode;
  params: Promise<{ id: string }>;
};

/**
 * Security boundary for every vehicle-detail child route.
 *
 * The fleet list already applies workspace record scope, but a dynamic vehicle
 * URL must repeat that check so a valid user cannot bypass tenant/assigned/
 * related scope by navigating directly to a vehicle UUID.
 */
export default async function VehicleLayout({ children, params }: VehicleLayoutProps) {
  // Let the child page retain its existing "Database Not Configured" state.
  if (!isDbConnected()) return children;

  const session = await getServerSession();
  if (!session) notFound();

  const roleNames = await getSessionRoleNames(session);
  const access = resolveDashboardAccess('/dashboard/fleet', roleNames);
  if (!access.allowed || !access.actions.includes('view') || !access.recordScope) notFound();

  const { id } = await params;
  const db = getDb();
  const [vehicle] = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(
      and(
        eq(vehicles.id, id),
        vehicleScopeCondition({
          tenantId: session.tenantId,
          userId: session.user.id,
          recordScope: access.recordScope,
        }),
      ),
    )
    .limit(1);

  if (!vehicle) notFound();

  return children;
}
