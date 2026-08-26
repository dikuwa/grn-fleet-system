import { notFound } from 'next/navigation';
import { getServerSession } from '@/lib/session';
import { requireDashboardAction } from '@/lib/auth-helpers';

export default async function LegalPolicyLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) notFound();
  const access = await requireDashboardAction(session, '/dashboard/admin/legal-policy', 'view');
  if (access !== true) notFound();
  return children;
}
