'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { formatCurrency, formatDate } from '@/lib/utils';
import { AlertTriangle, Camera, Loader2, Receipt, RefreshCw, X } from 'lucide-react';

interface ExpenseTransaction {
  id: string;
  transactionAt: string;
  litres: string;
  amount: string;
  fuelType: string;
  paymentMethod: string;
  stationName: string | null;
  fillType: string;
  anomalyState: string;
  vehicleLicence: string;
  vehicleId: string;
}

interface ReimbursementItem {
  id: string;
  transactionId: string;
  amount: string;
  state: string;
  claimantName: string;
}

interface MissingReceipt {
  id: string;
  transactionAt: string;
  amount: string;
  vehicleLicence: string;
  stationName: string | null;
}

interface ScanResult {
  status: string;
  manualEntryRequired: boolean;
  fields: Record<string, unknown>;
  confidence: Record<string, number>;
  extractionConfidence: number;
  flags: string[];
  matchedVehicle: { id: string; licenceNumber: string } | null;
  error?: string;
}

interface ExpenseSummary {
  totalFuelCost: number;
  totalLitres: number;
  avgCostPerLitre: number;
  receiptCoverage: number;
  missingReceiptCount: number;
  pendingReimbursements: number;
  flaggedAnomalies: number;
}

const PERIOD_OPTIONS = [
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
  { value: '90d', label: '90 Days' },
  { value: '1y', label: '1 Year' },
];

export default function ExpensesPage() {
  const [transactions, setTransactions] = useState<ExpenseTransaction[]>([]);
  const [reimbursements, setReimbursements] = useState<ReimbursementItem[]>([]);
  const [missingReceipts, setMissingReceipts] = useState<MissingReceipt[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState('90d');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fetchedPeriodRef = useRef<string | null>(null);

  const fetchData = useCallback(async (selectedPeriod: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/fleet/expenses?period=${selectedPeriod}`);
      if (!res.ok) throw new Error('Failed to load expense data');
      const json = await res.json();
      setTransactions(json.transactions || []);
      setReimbursements(json.reimbursements || []);
      setMissingReceipts(json.missingReceipts || []);
      setSummary(json.summary || null);
      fetchedPeriodRef.current = selectedPeriod;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fetchedPeriodRef.current === period) return;
    void fetchData(period);
  }, [fetchData, period]);

  const handleScanReceipt = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setScanLoading(true);
    setScanResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/fuel/receipts/scan', { method: 'POST', body: formData });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Scan failed');
      setScanResult(json as ScanResult);
      await fetchData(period);
    } catch (err) {
      setScanResult({
        status: 'ocr_failed',
        manualEntryRequired: true,
        fields: {},
        confidence: {},
        extractionConfidence: 0,
        flags: [],
        matchedVehicle: null,
        error: err instanceof Error ? err.message : 'Scan failed',
      });
    } finally {
      setScanLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const anomalyVariant = (state: string): 'success' | 'error' | 'pending' | 'info' => {
    if (state === 'none' || state === 'verified') return 'success';
    if (state === 'flagged') return 'pending';
    if (state === 'rejected') return 'error';
    return 'info';
  };

  const receiptCoverageTone = !summary
    ? 'text-ink-950'
    : summary.receiptCoverage >= 80
      ? 'text-status-success-text'
      : summary.receiptCoverage >= 50
        ? 'text-status-warning-text'
        : 'text-status-error-text';

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Fleet', href: '/dashboard/fleet' },
        { label: 'Expenses' },
      ]} />
      <PageHeader
        title="Fleet Expenses"
        description="Fuel costs, receipt tracking, OCR capture and reimbursement management."
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          className="hidden"
          onChange={handleScanReceipt}
          aria-label="Upload receipt for scanning"
        />
        <Button size="sm" onClick={() => fileInputRef.current?.click()} loading={scanLoading}>
          <Camera className="h-4 w-4" aria-hidden="true" /> Scan Receipt
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void fetchData(period)} loading={loading}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
        </Button>
      </PageHeader>

      {scanResult && (
        <section className="border-brand-200 bg-brand-50 dark:border-brand-800 dark:bg-brand-950/30 rounded-[10px] border p-4" aria-labelledby="receipt-scan-heading">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="receipt-scan-heading" className="text-brand-800 dark:text-brand-200 text-sm font-semibold">Receipt Scan Result</h2>
                <StatusBadge
                  status={scanResult.status === 'ocr_confirmed' ? 'success' : scanResult.status === 'ocr_failed' ? 'error' : 'pending'}
                  label={scanResult.status === 'ocr_confirmed' ? 'Extracted' : scanResult.status === 'ocr_failed' ? 'Failed' : 'Manual review required'}
                />
                {scanResult.matchedVehicle && <Badge variant="info" size="sm">Matched {scanResult.matchedVehicle.licenceNumber}</Badge>}
              </div>

              {scanResult.error ? (
                <p className="text-status-error-text mt-2 text-xs">{scanResult.error}</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {scanResult.flags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {scanResult.flags.map((flag) => <Badge key={flag} variant="warning" size="sm">{flag.replaceAll('_', ' ')}</Badge>)}
                    </div>
                  )}
                  {Object.keys(scanResult.fields).length > 0 ? (
                    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                      {Object.entries(scanResult.fields).map(([key, value]) => value !== undefined && value !== null && value !== '' ? (
                        <div key={key} className="min-w-0">
                          <dt className="text-brand-600 dark:text-brand-300 text-xs capitalize">{key.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt>
                          <dd className="text-brand-900 dark:text-brand-100 mt-0.5 break-words text-sm font-medium">{String(value)}</dd>
                        </div>
                      ) : null)}
                    </dl>
                  ) : (
                    <p className="text-brand-700 dark:text-brand-300 text-xs">No fields were extracted. Record the fuel entry manually and attach the receipt image.</p>
                  )}
                  <p className="text-brand-700 dark:text-brand-300 text-xs">Extraction confidence: {Math.round(scanResult.extractionConfidence * 100)}%. OCR remains provisional until the fuel record is confirmed.</p>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setScanResult(null)}
              className="focus-ring text-brand-600 hover:bg-brand-100 dark:hover:bg-brand-900/40 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px]"
              aria-label="Dismiss receipt scan result"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </section>
      )}

      {loading ? (
        <div className="text-ink-500 flex items-center justify-center gap-2 py-14 text-sm">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Loading expense data…
        </div>
      ) : error ? (
        <EmptyState icon={<AlertTriangle className="h-6 w-6" />} title="Unable to load fleet expenses" description={error} action={{ label: 'Retry', onClick: () => fetchData(period) }} />
      ) : !summary ? (
        <EmptyState icon={<Receipt className="h-8 w-8" />} title="No expense data" description="Add fuel transactions to view expense analytics." />
      ) : (
        <>
          <div className="border-border grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border bg-border lg:grid-cols-4">
            <div className="bg-surface p-4"><p className="text-ink-950 text-xl font-semibold tabular-nums sm:text-2xl">{formatCurrency(summary.totalFuelCost)}</p><p className="text-ink-500 mt-1 text-xs">Total Fuel Cost</p></div>
            <div className="bg-surface p-4"><p className="text-ink-950 text-xl font-semibold tabular-nums sm:text-2xl">{summary.totalLitres?.toLocaleString()} L</p><p className="text-ink-500 mt-1 text-xs">Total Litres</p><p className="text-ink-400 mt-0.5 text-[11px]">{formatCurrency(summary.avgCostPerLitre)}/L average</p></div>
            <div className="bg-surface p-4"><p className={`text-xl font-semibold tabular-nums sm:text-2xl ${receiptCoverageTone}`}>{summary.receiptCoverage}%</p><p className="text-ink-500 mt-1 text-xs">Receipt Coverage</p><p className="text-ink-400 mt-0.5 text-[11px]">{summary.missingReceiptCount} missing</p></div>
            <div className="bg-surface p-4"><p className="text-ink-950 text-xl font-semibold tabular-nums sm:text-2xl">{summary.pendingReimbursements}</p><p className="text-ink-500 mt-1 text-xs">Pending Reimbursements</p><p className="text-ink-400 mt-0.5 text-[11px]">{summary.flaggedAnomalies} flagged</p></div>
          </div>

          <div className="border-border flex flex-wrap items-center gap-1 border-y py-3" role="group" aria-label="Expense reporting period">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPeriod(option.value)}
                className={`focus-ring min-h-9 rounded-[7px] px-3 text-xs font-medium transition-colors motion-reduce:transition-none ${period === option.value ? 'bg-brand-800 text-white' : 'text-ink-500 hover:bg-muted hover:text-ink-800'}`}
                aria-pressed={period === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>

          {missingReceipts.length > 0 && (
            <section className="bg-status-warning-bg border-status-warning-text/20 rounded-[10px] border p-4" aria-labelledby="missing-receipts-heading">
              <h2 id="missing-receipts-heading" className="text-status-warning-text flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" /> {missingReceipts.length} transaction{missingReceipts.length === 1 ? '' : 's'} missing a receipt
              </h2>
              <div className="border-status-warning-text/10 mt-3 divide-y border-y">
                {missingReceipts.slice(0, 5).map((receipt) => (
                  <div key={receipt.id} className="grid gap-1 py-2 text-sm sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-4">
                    <span className="text-ink-800">{receipt.vehicleLicence}</span>
                    <span className="text-ink-600 font-medium">{formatCurrency(Number(receipt.amount))}</span>
                    <span className="text-ink-500 text-xs">{formatDate(receipt.transactionAt)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section aria-labelledby="recent-transactions-heading">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="recent-transactions-heading" className="text-ink-950 text-sm font-semibold">Recent Transactions ({transactions.length})</h2>
            </div>
            {transactions.length === 0 ? (
              <p className="text-ink-500 py-6 text-sm">No transactions in this period.</p>
            ) : (
              <div className="border-border bg-surface overflow-hidden rounded-[10px] border">
                {transactions.slice(0, 20).map((transaction) => (
                  <div key={transaction.id} className="border-border grid gap-3 border-b px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-ink-950 text-sm font-medium">{transaction.vehicleLicence}</p>
                        <StatusBadge status={anomalyVariant(transaction.anomalyState)} label={transaction.anomalyState} />
                      </div>
                      <div className="text-ink-500 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <span>{formatDate(transaction.transactionAt)}</span>
                        <span>{Number(transaction.litres).toFixed(1)} L</span>
                        <Badge variant="info" size="sm">{transaction.paymentMethod}</Badge>
                        {transaction.stationName && <span>{transaction.stationName}</span>}
                      </div>
                    </div>
                    <p className="text-ink-950 text-sm font-semibold">{formatCurrency(Number(transaction.amount))}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {reimbursements.length > 0 && (
            <section className="border-border border-t pt-5" aria-labelledby="reimbursements-heading">
              <h2 id="reimbursements-heading" className="text-ink-950 mb-3 text-sm font-semibold">Reimbursements ({reimbursements.length})</h2>
              <div className="divide-border divide-y">
                {reimbursements.slice(0, 10).map((reimbursement) => (
                  <div key={reimbursement.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="text-ink-950 text-sm font-medium">{reimbursement.claimantName}</p>
                      <StatusBadge
                        status={reimbursement.state === 'paid' ? 'success' : reimbursement.state === 'approved' ? 'info' : reimbursement.state === 'rejected' ? 'error' : 'pending'}
                        label={reimbursement.state}
                      />
                    </div>
                    <p className="text-ink-950 text-sm font-medium">{formatCurrency(Number(reimbursement.amount))}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
