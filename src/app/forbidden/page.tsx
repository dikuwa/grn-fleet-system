import Link from 'next/link';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { APP_NAME } from '@/lib/constants';
import { getServerSession } from '@/lib/session';
import { getSessionRoleNames } from '@/lib/auth-helpers';

export default async function ForbiddenPage() {
  const session = await getServerSession();
  const roleNames = session ? await getSessionRoleNames(session) : [];
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md rounded-[14px] border border-border bg-surface p-6 text-center shadow-sm sm:p-8">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-[12px] bg-status-error-bg">
          <ShieldAlert className="h-7 w-7 text-status-error-text" />
        </div>
        <h1 className="text-2xl font-[650] tracking-tight text-ink-950">Access restricted</h1>
        <p className="mt-2 text-sm leading-6 text-ink-500">
          This workspace is not part of your current responsibilities. No protected record or action has been loaded.
        </p>
        <div className="mt-5 rounded-[8px] border border-border bg-canvas p-3 text-left">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Current role</p>
          <p className="mt-1 text-sm text-ink-800">{roleNames.join(' + ') || 'Authenticated employee'}</p>
        </div>
        <Button className="mt-6 w-full" variant="primary" asChild>
          <Link href="/dashboard"><ArrowLeft className="h-4 w-4" />Return to dashboard</Link>
        </Button>
        <p className="mt-6 text-xs text-ink-400">&copy; {new Date().getFullYear()} {APP_NAME}</p>
      </div>
    </main>
  );
}
