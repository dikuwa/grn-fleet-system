import Link from 'next/link';
import { APP_SHORT_NAME } from '@/lib/constants';
import { PublicThemeToggle } from '@/components/layout/public-theme-toggle';
import { ExternalRequestForm } from './ExternalRequestForm';

export const dynamic = 'force-dynamic';

export default async function ExternalRequestPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <main className="min-h-screen bg-canvas">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-800 text-sm font-bold text-white">G</span>
            <span className="text-sm font-semibold text-ink-950">{APP_SHORT_NAME}</span>
          </Link>
          <PublicThemeToggle />
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
        <ExternalRequestForm token={token} />
        <p className="mt-6 text-center text-xs text-ink-500">
          Secure external intake. Internal approvers, fleet records, drivers and tenant administration are not exposed through this form.
        </p>
      </div>
    </main>
  );
}
