import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { isDbConnected, getDb } from '@/db';
import { importBatches } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { Upload, Database, FileSpreadsheet, ChevronRight } from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

async function fetchImportHistory() {
  const dbo = getDb();
  return dbo
    .select()
    .from(importBatches)
    .where(eq(importBatches.importType, 'staff'))
    .orderBy(desc(importBatches.createdAt))
    .limit(50);
}

export default async function ImportHistoryPage() {
  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Staff Directory', href: '/dashboard/staff' }, { label: 'Import History' }]} />
        <PageHeader title="Import History" description="Previous staff data imports" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" description="Database connection is required to view import history." />
      </div>
    );
  }

  let batches: Awaited<ReturnType<typeof fetchImportHistory>>;
  try {
    batches = await fetchImportHistory();
  } catch (error) {
    console.error('Import history query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Staff Directory', href: '/dashboard/staff' }, { label: 'Import History' }]} />
        <PageHeader title="Import History" description="Previous staff data imports" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Import History" description="The database query failed. Please ensure migrations have been run." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Staff Directory', href: '/dashboard/staff' }, { label: 'Import History' }]} />
      <PageHeader
        title="Import History"
        description={batches.length > 0 ? `${batches.length} previous import${batches.length !== 1 ? 's' : ''}` : 'Track staff data imports'}
      >
        <Button variant="primary" size="sm" asChild>
          <Link href="/dashboard/staff/import"><Upload className="h-4 w-4" />New Import</Link>
        </Button>
      </PageHeader>

      {batches.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon={<FileSpreadsheet className="h-6 w-6" />}
              title="No Imports Yet"
              description="Staff data imports will appear here once you upload and process a CSV file."
              action={{ label: 'Import Staff', onClick: () => { window.location.href = '/dashboard/staff/import'; } }}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">File</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Total</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Valid</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Errors</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Committed</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Date</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-ink-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {batches.map((batch) => (
                  <tr key={batch.id} className="hover:bg-canvas/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="h-4 w-4 text-brand-600" />
                        <span className="text-sm font-medium text-ink-950 truncate max-w-[200px]">{batch.fileName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        status={batch.status === 'committed' ? 'success' : batch.status === 'partially_committed' ? 'pending' : batch.status === 'failed' ? 'error' : 'info'}
                        label={batch.status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                      />
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums text-ink-700">{batch.totalRows || '-'}</td>
                    <td className="px-4 py-3 text-xs tabular-nums text-status-success-text">{batch.validRows || '-'}</td>
                    <td className="px-4 py-3 text-xs tabular-nums text-status-error-text">{batch.errorRows || '-'}</td>
                    <td className="px-4 py-3 text-xs tabular-nums text-ink-700">{batch.committedRows || '-'}</td>
                    <td className="px-4 py-3 text-xs text-ink-500">
                      {batch.createdAt.toLocaleDateString('en-NA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs font-medium text-brand-600 inline-flex items-center gap-1">
                        Details <ChevronRight className="h-3 w-3" />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
