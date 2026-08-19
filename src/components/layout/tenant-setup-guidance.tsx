import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { tenantSetupProgress, tenants } from '@/db/schema';
import { WorkspaceIds, type WorkspaceId } from '@/lib/workspaces';

interface TenantSetupGuidanceProps {
  tenantId: string;
  activeWorkspace: WorkspaceId;
  isPublicDemo?: boolean;
}

export async function TenantSetupGuidance({
  tenantId,
  activeWorkspace,
  isPublicDemo = false,
}: TenantSetupGuidanceProps) {
  if (isPublicDemo || activeWorkspace !== WorkspaceIds.TENANT_ADMIN) return null;

  const db = getDb();
  const [[tenant], [setup]] = await Promise.all([
    db
      .select({ lifecycleStatus: tenants.lifecycleStatus })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1),
    db
      .select({ isReady: tenantSetupProgress.isReady })
      .from(tenantSetupProgress)
      .where(eq(tenantSetupProgress.tenantId, tenantId))
      .limit(1),
  ]);

  if (!tenant || tenant.lifecycleStatus !== 'SETUP_IN_PROGRESS') return null;

  const initialReady = setup?.isReady === true;
  const href = initialReady ? '/dashboard/setup/operational' : '/dashboard/setup';
  const title = initialReady ? 'Finish operational setup' : 'Complete initial setup';
  const description = initialReady
    ? 'Confirm the approval workflow and remaining required items, then submit the tenant for Platform Review.'
    : 'Confirm the organisation and at least one operating location. Optional details can be completed later.';

  return (
    <section
      aria-label="Tenant setup guidance"
      className="mb-4 flex flex-col gap-3 rounded-[8px] border border-brand-200 bg-brand-50/50 px-4 py-3 dark:border-brand-900/60 dark:bg-brand-950/20 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink-950">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-ink-600">{description}</p>
      </div>
      <Link
        href={href}
        className="focus-ring inline-flex min-h-9 shrink-0 items-center gap-1.5 self-start rounded-[7px] border border-brand-200 bg-surface px-3 py-2 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-50 dark:border-brand-900/60 dark:hover:bg-brand-950/40 sm:self-auto"
      >
        Continue setup <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </section>
  );
}
