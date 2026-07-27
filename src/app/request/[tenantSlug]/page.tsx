import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/db';
import { tenants } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { APP_SHORT_NAME } from '@/lib/constants';
import { PublicThemeToggle } from '@/components/layout/public-theme-toggle';
import { SecureRequestForm } from './SecureRequestForm';

export const dynamic = 'force-dynamic';

export default async function TenantSecureRequestPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const db = getDb();
  const [tenant] = await db.select({ name: tenants.name, slug: tenants.slug }).from(tenants)
    .where(and(eq(tenants.slug, tenantSlug), eq(tenants.status, 'active'))).limit(1);
  if (!tenant) notFound();
  return (
    <main className="min-h-screen bg-canvas">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-800 text-sm font-bold text-white">G</span><span className="text-sm font-semibold text-ink-950">{APP_SHORT_NAME}</span></Link>
          <PublicThemeToggle />
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">{tenant.name}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink-950 sm:text-3xl">Employee transport request</h1>
          <p className="mt-2 text-sm text-ink-500">Secure access for employees without a dashboard account. Your identity is verified by one-time code.</p>
        </div>
        <SecureRequestForm tenantSlug={tenant.slug} tenantName={tenant.name} />
        <p className="mt-6 text-center text-xs text-ink-500">Need help? Ask your administration or transport office to submit an assisted request.</p>
      </div>
    </main>
  );
}
