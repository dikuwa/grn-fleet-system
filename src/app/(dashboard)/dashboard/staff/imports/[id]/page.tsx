import { getDb, isDbConnected } from '@/db';
import { importBatches, importRows } from '@/db/schema';
import { eq, and, desc, asc } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Database, FileSpreadsheet, Upload, Download, ChevronLeft,
  CheckCircle2, XCircle, AlertTriangle, Clock, User, Hash,
} from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import { notFound } from 'next/navigation';
import Link from 'next/link';

interface PageProps {
  params: Promise<{ id: string }>;
}

async function fetchBatchDetail(id: string, tenantId: string) {
  const db = getDb();

  const [batch] = await db
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.id, id), eq(importBatches.tenantId, tenantId)))
    .limit(1);

  if (!batch) return null;

  const rows = await db
    .select()
    .from(importRows)
    .where(eq(importRows.batchId, id))
    .orderBy(asc(importRows.rowNumber));

  return { batch, rows };
}

export default async function ImportBatchDetailPage({ params }: PageProps) {
  const { id } = await params;

  const session = await getServerSession();
  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Staff Directory', href: '/dashboard/staff' },
          { label: 'Import History', href: '/dashboard/staff/imports' },
          { label: 'Batch Detail' },
        ]} />
        <PageHeader title="Import Batch Detail" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Staff Directory', href: '/dashboard/staff' },
          { label: 'Import History', href: '/dashboard/staff/imports' },
          { label: 'Batch Detail' },
        ]} />
        <PageHeader title="Import Batch Detail" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  let data: Awaited<ReturnType<typeof fetchBatchDetail>>;
  try {
    data = await fetchBatchDetail(id, session.tenantId);
  } catch (error) {
    console.error('Batch detail query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Staff Directory', href: '/dashboard/staff' },
          { label: 'Import History', href: '/dashboard/staff/imports' },
          { label: 'Batch Detail' },
        ]} />
        <PageHeader title="Import Batch Detail" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Batch" />
      </div>
    );
  }

  if (!data) notFound();
  const { batch, rows } = data;

  const isCommitted = batch.status === 'committed' || batch.status === 'partially_committed';
  const hasErrors = batch.status === 'failed' || batch.status === 'partially_committed';

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Staff Directory', href: '/dashboard/staff' },
        { label: 'Import History', href: '/dashboard/staff/imports' },
        { label: batch.fileName },
      ]} />
      <PageHeader
        title={batch.fileName}
        description={`${batch.totalRows || 0} rows · ${batch.importType} import`}
      >
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/staff/import"><Upload className="h-4 w-4" /> New Import</Link>
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/staff/imports"><ChevronLeft className="h-4 w-4" /> Back</Link>
          </Button>
        </div>
      </PageHeader>

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-ink-950">{batch.totalRows || 0}</p>
            <div className="mt-1 flex items-center justify-center gap-1 text-xs text-ink-500">
              <Hash className="h-3 w-3" /> Total Rows
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-status-success-text">{batch.validRows || 0}</p>
            <div className="mt-1 flex items-center justify-center gap-1 text-xs text-ink-500">
              <CheckCircle2 className="h-3 w-3" /> Valid
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-status-error-text">{batch.errorRows || 0}</p>
            <div className="mt-1 flex items-center justify-center gap-1 text-xs text-ink-500">
              <XCircle className="h-3 w-3" /> Errors
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-brand-600">{batch.committedRows || 0}</p>
            <div className="mt-1 flex items-center justify-center gap-1 text-xs text-ink-500">
              <Database className="h-3 w-3" /> Committed
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Batch Details Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" /> Batch Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-500">Status</span>
                <StatusBadge
                  status={
                    batch.status === 'committed' ? 'success'
                    : batch.status === 'partially_committed' ? 'pending'
                    : batch.status === 'failed' ? 'error'
                    : batch.status === 'validated' ? 'info'
                    : 'info'
                  }
                  label={batch.status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-500">Import Type</span>
                <span className="text-ink-950 capitalize">{batch.importType}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-500">Success Rate</span>
                <span className="tab-nums text-ink-950">
                  {batch.totalRows && batch.totalRows > 0
                    ? `${Math.round(((batch.committedRows || 0) / batch.totalRows) * 100)}%`
                    : '—'}
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-500">Imported By</span>
                <span className="text-ink-950">{batch.importedByUserId ? `User ${batch.importedByUserId.slice(0, 8)}` : '—'}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-500">Created</span>
                <span className="text-ink-950">{formatDateTime(batch.createdAt)}</span>
              </div>
              {batch.committedAt && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink-500">Committed</span>
                  <span className="text-ink-950">{formatDateTime(batch.committedAt)}</span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Import Rows */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" /> Import Rows
            <span className="text-sm font-normal text-ink-500">({rows.length} rows)</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-sm text-ink-500">No rows found for this batch.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted">
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">#</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Entity</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Errors</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => {
                    const rowHasErrors = row.validationErrors && row.validationErrors.length > 0;
                    return (
                      <tr key={row.id} className={`hover:bg-canvas/50 transition-colors ${!row.isCommitted && rowHasErrors ? 'bg-status-error-bg/10' : ''}`}>
                        <td className="px-4 py-3 text-xs tabular-nums text-ink-500">{row.rowNumber}</td>
                        <td className="px-4 py-3">
                          {row.isCommitted ? (
                            <StatusBadge status="success" label="Committed" />
                          ) : rowHasErrors ? (
                            <StatusBadge status="error" label="Failed" />
                          ) : (
                            <StatusBadge status="pending" label="Pending" />
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {row.commitEntityId ? (
                            <Link
                              href={`/dashboard/staff/${row.commitEntityId}`}
                              className="text-xs font-medium text-brand-600 hover:text-brand-700"
                            >
                              {row.commitEntityId.slice(0, 8)}
                            </Link>
                          ) : (
                            <span className="text-xs text-ink-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {rowHasErrors ? (
                            <div className="space-y-1">
                              {row.validationErrors!.map((err, i) => (
                                <p key={i} className="flex items-start gap-1 text-xs text-status-error-text">
                                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                                  <span>{err}</span>
                                </p>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-ink-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
