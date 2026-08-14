import { getServerSession } from '@/lib/session';
import { getSessionRoleNames } from '@/lib/auth-helpers';
import { SystemRoles } from '@/lib/workspaces';
import { DriverExpenseCapture } from './DriverExpenseCapture';

export default async function TripDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession();
  if (!session) return children;

  const roleNames = await getSessionRoleNames(session);
  const isDriver = roleNames.includes(SystemRoles.DRIVER);
  const { id } = await params;

  return (
    <div className="space-y-6">
      {children}
      {isDriver && <DriverExpenseCapture tripId={id} />}
    </div>
  );
}
