'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { formatCurrency, formatDate } from '@/lib/utils';
import {
  Receipt, AlertTriangle, Loader2, RefreshCw,
  DollarSign, FileText, CheckCircle2, XCircle,
  Upload, Search, Camera, ChevronRight,
} from 'lucide-react';
import Link from 'next/link';

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

export default function ExpensesPage() {
  const [transactions, setTransactions] = useState<ExpenseTransaction[]>([]);
  const [reimbursements, setReimbursements] = useState<ReimbursementItem[]>([]);
  const [missingReceipts, setMissingReceipts] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState('90d');
  const [showScanner, setShowScanner] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fetched = useRef(false);

  const fetchData = useCallback(async (p: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/fleet/expenses?period=${p}`);
      if (!res.ok) throw new Error('Failed to load expense data');
      const json = await res.json();
      setTransactions(json.transactions || []);
      setReimbursements(json.reimbursements || []);
      setMissingReceipts(json.missingReceipts || []);
      setSummary(json.summary || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    fetchData(period);
  }, [fetchData, period]);

  const handleScanReceipt = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanLoading(true);
    setScanResult(null);

    try {
      // Upload to R2
      const formData = new FormData();
      formData.append('file', file);
      formData.append('category', 'receipt');

      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!uploadRes.ok) {
        const err = await uploadRes.json();
        throw new Error(err.error || 'Upload failed');
      }

      const uploadJson = await uploadRes.json();

      // Try OCR via Tesseract.js (dynamically loaded)
      let ocrText = '';
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const TesseractMod: any = await import('tesseract.js' as string).catch(() => null);
        if (TesseractMod && typeof TesseractMod.recognize === 'function') {
          const result = await TesseractMod.recognize(file, 'eng');
          ocrText = result.data?.text || 'No text extracted';
        } else {
          ocrText = 'OCR processing unavailable (Tesseract.js not installed)';
        }
      } catch {
        ocrText = 'OCR processing unavailable (Tesseract.js not available)';
      }

      setScanResult(`Receipt uploaded: ${file.name}\n\nOCR Result:\n${ocrText.slice(0, 500)}`);
      await fetchData(period);
    } catch (err) {
      setScanResult(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setScanLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const periodOptions = [
    { value: '7d', label: '7 Days' },
    { value: '30d', label: '30 Days' },
    { value: '90d', label: '90 Days' },
    { value: '1y', label: '1 Year' },
  ];

  const anomalyVariant = (state: string): 'success' | 'error' | 'pending' | 'info' => {
    switch (state) {
      case 'none': return 'success';
      case 'verified': return 'success';
      case 'flagged': return 'pending';
      case 'rejected': return 'error';
      default: return 'info';
    }
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Fleet', href: '/dashboard/fleet' },
        { label: 'Expenses' },
      ]} />
      <PageHeader
        title="Fleet Expenses"
        description="Fuel costs, receipt tracking, OCR capture, and reimbursement management"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          className="hidden"
          onChange={handleScanReceipt}
        />
        <Button variant="primary" size="sm" onClick={() => fileInputRef.current?.click()} loading={scanLoading}>
          <Camera className="h-4 w-4" />
          Scan Receipt
        </Button>
        <Button variant="secondary" size="sm" onClick={() => fetchData(period)} loading={loading}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </PageHeader>

      {/* Scan Result Toast */}
      {scanResult && (
        <Card className="border-brand-200 bg-brand-50/50">
          <CardContent className="pt-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <p className="text-sm font-medium text-brand-800 mb-1">Receipt Scan Result</p>
                <pre className="text-xs text-brand-600 whitespace-pre-wrap font-sans">{scanResult}</pre>
              </div>
              <button onClick={() => setScanResult(null)} className="text-brand-400 hover:text-brand-600">&times;</button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-ink-400" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <AlertTriangle className="h-8 w-8 text-status-error-text" />
          <p className="text-sm text-ink-500">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => fetchData(period)}>Retry</Button>
        </div>
      ) : !summary ? (
        <EmptyState icon={<Receipt className="h-8 w-8" />} title="No expense data" description="Add fuel transactions to view expense analytics." />
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid gap-4 sm:grid-cols-4">
            <Card><CardContent className="pt-4">
              <div className="text-center">
                <p className="text-2xl font-[650] tabular-nums text-ink-950">{formatCurrency(summary.totalFuelCost)}</p>
                <p className="text-xs text-ink-500">Total Fuel Cost</p>
              </div>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="text-center">
                <p className="text-2xl font-[650] tabular-nums text-ink-950">{summary.totalLitres?.toLocaleString()} L</p>
                <p className="text-xs text-ink-500">Total Litres</p>
                <p className="text-xs text-ink-400">{formatCurrency(summary.avgCostPerLitre)}/L avg</p>
              </div>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="text-center">
                <p className={`text-2xl font-[650] tabular-nums ${summary.receiptCoverage >= 80 ? 'text-green-600' : summary.receiptCoverage >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                  {summary.receiptCoverage}%
                </p>
                <p className="text-xs text-ink-500">Receipt Coverage</p>
                <p className="text-xs text-ink-400">{summary.missingReceiptCount} missing</p>
              </div>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="text-center">
                <p className="text-2xl font-[650] tabular-nums text-ink-950">{summary.pendingReimbursements}</p>
                <p className="text-xs text-ink-500">Pending Reimbursements</p>
                <p className="text-xs text-ink-400">{summary.flaggedAnomalies} flagged</p>
              </div>
            </CardContent></Card>
          </div>

          {/* Period Selector */}
          <div className="flex items-center gap-2">
            {periodOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => { setPeriod(opt.value); fetched.current = false; }}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  period === opt.value ? 'bg-ink-950 text-white' : 'bg-canvas text-ink-500 hover:bg-ink-100'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Missing Receipts Alert */}
          {missingReceipts.length > 0 && (
            <Card className="border-amber-200 bg-amber-50/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-amber-800 text-sm">
                  <AlertTriangle className="h-4 w-4" />
                  {missingReceipts.length} Transaction(s) Missing Receipt
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {missingReceipts.slice(0, 5).map((mr: any) => (
                    <div key={mr.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm">
                      <span className="text-ink-700">{mr.vehicleLicence}</span>
                      <span className="text-ink-500">{formatCurrency(Number(mr.amount))}</span>
                      <span className="text-xs text-ink-400">{formatDate(mr.transactionAt)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent Transactions */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Transactions ({transactions.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {transactions.length === 0 ? (
                <div className="px-5 pb-4"><p className="text-sm text-ink-500">No transactions in this period.</p></div>
              ) : (
                <div className="divide-y divide-border">
                  {transactions.slice(0, 20).map((t) => (
                    <div key={t.id} className="px-5 py-3 flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-ink-950">{t.vehicleLicence}</p>
                          <StatusBadge status={anomalyVariant(t.anomalyState)} label={t.anomalyState} />
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-ink-500">
                          <span>{formatDate(t.transactionAt)}</span>
                          <span>{Number(t.litres).toFixed(1)} L</span>
                          <Badge variant="info" size="sm">{t.paymentMethod}</Badge>
                          {t.stationName && <span>{t.stationName}</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-medium text-ink-950">{formatCurrency(Number(t.amount))}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Reimbursements */}
          {reimbursements.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Reimbursements ({reimbursements.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {reimbursements.slice(0, 10).map((r) => (
                    <div key={r.id} className="px-5 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-ink-950">{r.claimantName}</p>
                        <StatusBadge
                          status={r.state === 'paid' ? 'success' : r.state === 'approved' ? 'info' : r.state === 'rejected' ? 'error' : 'pending'}
                          label={r.state}
                        />
                      </div>
                      <p className="text-sm font-medium">{formatCurrency(Number(r.amount))}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
