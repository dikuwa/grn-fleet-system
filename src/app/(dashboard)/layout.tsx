import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/session';
import { DashboardShell } from '@/components/layout/dashboard-shell';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side session validation — redirect to login if not authenticated
  const session = await getServerSession();

  if (!session) {
    redirect('/login?redirect=/dashboard');
  }

  // Tenant membership validation (belt-and-suspenders)
  // If the session exists but tenant membership is invalid, redirect to login
  if (!session.tenantId) {
    redirect('/login?redirect=/dashboard&error=tenant');
  }

  return <DashboardShell tenantName={session.tenantSlug}>{children}</DashboardShell>;
}
