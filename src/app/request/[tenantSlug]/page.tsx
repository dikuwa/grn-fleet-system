import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/db';
import { tenants } from '@/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { APP_SHORT_NAME } from '@/lib/constants';
import { PublicThemeToggle } from '@/components/layout/public-theme-toggle';
import { SecureRequestForm } from './SecureRequestForm';

export const dynamic = 'force-dynamic';

export default async function TenantSecureRequestPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const db = getDb();
  const [tenant] = await db
    .select({ name: tenants.name, slug: tenants.slug })
    .from(tenants)
    // Status is stored uppercase (ACTIVE) — compare case-insensitively so the
    // public page works regardless of storage casing.
    .where(and(eq(tenants.slug, tenantSlug), sql`lower(${tenants.status}) = 'active'`))
    .limit(1);
  if (!tenant) notFound();
  return (
    <main className="bg-canvas min-h-screen">
      <header className="border-border bg-surface border-b">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="bg-brand-800 flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white">
              G
            </span>
            <span className="text-ink-950 text-sm font-semibold">{APP_SHORT_NAME}</span>
          </Link>
          <PublicThemeToggle />
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-6">
          <p className="text-brand-700 text-xs font-semibold tracking-wider uppercase">
            {tenant.name}
          </p>
          <h1 className="text-ink-950 mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Employee transport request
          </h1>
          <p className="text-ink-500 mt-2 text-sm">
            Secure access for employees without a dashboard account. Your identity is verified by
            one-time code.
          </p>
        </div>
        <SecureRequestForm tenantSlug={tenant.slug} tenantName={tenant.name} />
        <p className="text-ink-500 mt-6 text-center text-xs">
          Employee self-service only — this is not a public external intake form. Genuine external
          requesters must ask the tenant administration or transport office to use External Request
          Intake.
        </p>
      </div>
    </main>
  );
}
