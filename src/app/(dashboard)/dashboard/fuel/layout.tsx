import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerSession } from '@/lib/session';
import { getSessionPermissions, requireDashboardAction } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

export default async function FuelLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) notFound();

  const access = await requireDashboardAction(session, '/dashboard/fuel', 'view');
  if (access !== true) notFound();

  const permissions = await getSessionPermissions(session);
  const canOpenReceiptRegister =
    permissions.includes(Permissions.FUEL_MANAGE) || permissions.includes(Permissions.FUEL_VERIFY);
  const canOpenExpenses =
    permissions.includes(Permissions.FUEL_MANAGE) || permissions.includes(Permissions.TRIP_MANAGE);

  return (
    <div className="space-y-4">
      {(canOpenReceiptRegister || canOpenExpenses) && (
        <nav
          aria-label="Fuel records navigation"
          className="flex flex-wrap items-center gap-1 rounded-[8px] border border-border bg-surface p-1"
        >
          <Link
            href="/dashboard/fuel"
            className="focus-ring min-h-9 rounded-[6px] px-3 py-2 text-xs font-medium text-ink-700 hover:bg-muted"
          >
            Fuel Records
          </Link>
          {canOpenReceiptRegister && (
            <Link
              href="/dashboard/fuel/receipts"
              className="focus-ring min-h-9 rounded-[6px] px-3 py-2 text-xs font-medium text-ink-700 hover:bg-muted"
            >
              Receipt Register
            </Link>
          )}
          {canOpenExpenses && (
            <Link
              href="/dashboard/fuel/expenses"
              className="focus-ring min-h-9 rounded-[6px] px-3 py-2 text-xs font-medium text-ink-700 hover:bg-muted"
            >
              Operational Expenses
            </Link>
          )}
        </nav>
      )}
      {children}
    </div>
  );
}
