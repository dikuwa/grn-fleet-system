'use client';

import { useCallback, useEffect, useState } from 'react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { StyledSelect } from '@/components/ui/styled-select';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/lib/use-toast';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { FileImage, Loader2, RefreshCw, Search, X } from 'lucide-react';

type ReceiptRow = {
  id: string;
  transactionId: string;
  originalFileName: string;
  ocrStatus: string;
  extractionConfidence: string | null;
  isVerified: boolean;
  transactionAt: string;
  stationName: string | null;
  referenceNumber: string | null;
  amount: string;
  litres: string;
  fuelType: string;
  anomalyState: string;
  transactionVerified: boolean;
  vehicleLicence: string;
  vehicleRegisterNumber: string | null;
  vehicleMake: string;
  vehicleModel: string;
  driverFirstName: string | null;
  driverLastName: string | null;
};

export default function ReceiptRegisterPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ search: '', from: '', to: '', ocrStatus: '', verification: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => value && params.set(key, value));
      const response = await fetch(`/api/fuel/receipts/register?${params.toString()}`, { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Could not load receipt register');
      setRows(Array.isArray(json.data) ? json.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load receipt register');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function openEvidence(receiptId: string) {
    setOpeningId(receiptId);
    try {
      const response = await fetch(`/api/fuel/receipts/${receiptId}/evidence`, { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Receipt evidence is unavailable');
      const url = json.data?.url as string | undefined;
      if (!url) throw new Error('Receipt evidence is unavailable');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast({
        title: 'Unable to open receipt',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'error',
      });
    } finally {
      setOpeningId(null);
    }
  }

  const clear = () => setFilters({ search: '', from: '', to: '', ocrStatus: '', verification: '' });

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Fuel Records', href: '/dashboard/fuel' },
        { label: 'Receipt Register' },
      ]} />
      <PageHeader
        title="Receipt Register"
        description="Search original fuel receipt evidence and its OCR/verification state."
      >
        <Button variant="secondary" size="sm" onClick={() => void load()} loading={loading}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </PageHeader>

      <div className="rounded-[10px] border border-border bg-surface p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="space-y-1.5 xl:col-span-2">
            <Label>Search</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <Input
                className="pl-9"
                placeholder="Receipt, station, vehicle or driver…"
                value={filters.search}
                onChange={(event) => setFilters((value) => ({ ...value, search: event.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>From</Label>
            <Input type="date" value={filters.from} onChange={(event) => setFilters((value) => ({ ...value, from: event.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>To</Label>
            <Input type="date" value={filters.to} onChange={(event) => setFilters((value) => ({ ...value, to: event.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Receipt status</Label>
            <StyledSelect value={filters.verification} onChange={(event) => setFilters((value) => ({ ...value, verification: event.target.value }))}>
              <option value="">All</option>
              <option value="verified">Verified evidence</option>
              <option value="unverified">Unverified evidence</option>
            </StyledSelect>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StyledSelect
            className="max-w-xs"
            value={filters.ocrStatus}
            onChange={(event) => setFilters((value) => ({ ...value, ocrStatus: event.target.value }))}
          >
            <option value="">All OCR states</option>
            <option value="ocr_confirmed">OCR confirmed</option>
            <option value="manually_corrected">Manually corrected</option>
            <option value="awaiting_verification">Awaiting verification</option>
            <option value="ocr_failed">OCR failed</option>
          </StyledSelect>
          <Button variant="ghost" size="sm" onClick={clear}>
            <X className="h-4 w-4" /> Clear filters
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-500">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" /> Loading receipts…
        </div>
      ) : error ? (
        <EmptyState icon={<FileImage className="h-6 w-6" />} title="Unable to load receipts" description={error} action={{ label: 'Retry', onClick: load }} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<FileImage className="h-6 w-6" />} title="No matching receipts" description="Change the filters or record a fuel receipt first." />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-ink-500">{rows.length} receipt{rows.length === 1 ? '' : 's'} found</p>
          {rows.map((row) => (
            <article key={row.id} className="rounded-[10px] border border-border bg-surface p-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-ink-950">{row.originalFileName || 'Fuel receipt'}</p>
                    <Badge variant={row.isVerified ? 'success' : 'pending'} size="sm">
                      {row.isVerified ? 'Evidence verified' : row.ocrStatus.replaceAll('_', ' ')}
                    </Badge>
                    <Badge variant={row.transactionVerified ? 'success' : 'info'} size="sm">
                      {row.transactionVerified ? 'Transaction verified' : 'Transaction unverified'}
                    </Badge>
                    {row.anomalyState !== 'none' && <Badge variant="warning" size="sm">{row.anomalyState}</Badge>}
                  </div>
                  <div className="mt-2 grid gap-x-6 gap-y-1 text-xs text-ink-500 sm:grid-cols-2 xl:grid-cols-4">
                    <span>{row.vehicleLicence} · {row.vehicleMake} {row.vehicleModel}</span>
                    <span>{formatDateTime(row.transactionAt)}</span>
                    <span>{row.stationName || 'Station not recorded'}</span>
                    <span>{formatCurrency(Number(row.amount))} · {Number(row.litres).toFixed(2)} L</span>
                    <span>Driver: {[row.driverFirstName, row.driverLastName].filter(Boolean).join(' ') || 'Not recorded'}</span>
                    <span>Reference: {row.referenceNumber || '—'}</span>
                    <span>Fuel: {row.fuelType}</span>
                    <span>OCR confidence: {row.extractionConfidence ? `${Math.round(Number(row.extractionConfidence) * 100)}%` : '—'}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <Button variant="secondary" size="sm" onClick={() => void openEvidence(row.id)} loading={openingId === row.id}>
                    <FileImage className="h-4 w-4" /> Open receipt
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <a href={`/dashboard/fuel/${row.transactionId}`}>Fuel record</a>
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
