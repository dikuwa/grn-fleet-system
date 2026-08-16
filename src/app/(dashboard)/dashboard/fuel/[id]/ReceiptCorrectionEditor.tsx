'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ExternalLink, FileText, PencilLine, Save, X, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldWrapper, Input, Textarea } from '@/components/ui/input';
import { useToast } from '@/lib/use-toast';

interface ReceiptLike {
  id: string;
  originalFileName: string | null;
  createdAtLabel: string;
  isVerified: boolean;
  ocrStatus: string;
  extractionData: Record<string, unknown> | null;
  fieldConfidence?: Record<string, number> | null;
  extractionConfidence?: string | null;
  rawOcrResponse?: Record<string, unknown> | null;
}

interface FieldConfig { key: string; label: string; numeric?: boolean }

const FIELD_ORDER: FieldConfig[] = [
  { key: 'supplier', label: 'Supplier' },
  { key: 'stationLocation', label: 'Station location' },
  { key: 'transactionDate', label: 'Transaction date' },
  { key: 'transactionTime', label: 'Transaction time' },
  { key: 'transactionReference', label: 'Transaction reference' },
  { key: 'pumpNumber', label: 'Pump number' },
  { key: 'receiptNumber', label: 'Receipt number' },
  { key: 'fuelType', label: 'Fuel type' },
  { key: 'litres', label: 'Litres (L)', numeric: true },
  { key: 'amount', label: 'Amount', numeric: true },
  { key: 'pricePerLitre', label: 'Price per litre', numeric: true },
  { key: 'odometer', label: 'Odometer (km)', numeric: true },
  { key: 'registrationNumber', label: 'Registration number' },
  { key: 'attendant', label: 'Attendant' },
];

function stringValue(data: Record<string, unknown> | null, key: string): string {
  const value = data?.[key];
  return value === null || value === undefined ? '' : String(value);
}

function fieldValue(original: Record<string, string>, field: FieldConfig): string {
  return (original[field.key] ?? '').trim();
}

export function ReceiptCorrectionEditor({ receipt, canEdit, canVerify = false }: { receipt: ReceiptLike; canEdit: boolean; canVerify?: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const original = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const field of FIELD_ORDER) out[field.key] = stringValue(receipt.extractionData, field.key);
    return out;
  }, [receipt.extractionData]);
  const flags = Array.isArray(receipt.extractionData?.validationFlags)
    ? receipt.extractionData!.validationFlags.filter((value): value is string => typeof value === 'string')
    : [];
  const rawText = typeof receipt.rawOcrResponse?.text === 'string' ? receipt.rawOcrResponse.text : '';
  const engine = typeof receipt.rawOcrResponse?.engine === 'string' ? receipt.rawOcrResponse.engine : 'unknown';
  const overallConfidence = receipt.extractionConfidence ? Math.round(Number(receipt.extractionConfidence) * 100) : null;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>(original);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState<'verify' | 'reject' | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [opening, setOpening] = useState(false);
  const readOnly = receipt.isVerified || !canEdit;
  const hasUsefulFields = FIELD_ORDER.some((field) => fieldValue(original, field) !== '');

  async function openOriginal() {
    setOpening(true);
    try {
      const response = await fetch(`/api/fuel/receipts/${receipt.id}/evidence`, { cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.data?.url) throw new Error(result.error || 'Receipt evidence is unavailable');
      window.open(result.data.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast({ title: 'Unable to open receipt', description: error instanceof Error ? error.message : 'Please try again.', variant: 'error' });
    } finally { setOpening(false); }
  }

  async function patchAction(action: string, extra: Record<string, unknown> = {}) {
    const response = await fetch('/api/fuel/receipts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ receiptId: receipt.id, action, ...extra }) });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(result.error || 'Could not update receipt');
  }

  async function handleSave() {
    const changes: Record<string, string | number> = {};
    for (const field of FIELD_ORDER) {
      const value = draft[field.key] ?? '';
      const originalValue = original[field.key] ?? '';
      if (value === originalValue) continue;
      const trimmed = value.trim();
      if (field.numeric && trimmed !== '' && Number.isNaN(Number(value))) {
        toast({ title: 'Invalid number', description: `${field.label} must be a number.`, variant: 'error' });
        return;
      }
      changes[field.key] = field.numeric ? (trimmed === '' ? '' : Number(value)) : value;
    }
    if (!Object.keys(changes).length) {
      toast({ title: 'No changes to save', description: 'Adjust one or more receipt fields before saving.', variant: 'error' });
      return;
    }
    setSaving(true);
    try {
      await patchAction('correct', { corrections: changes });
      await patchAction('confirm');
      toast({ title: 'Receipt corrections saved', description: 'OCR confirmed. Final verification still requires an authorised review.', variant: 'success' });
      setEditing(false);
      router.refresh();
    } catch (error) {
      toast({ title: 'Unable to save corrections', description: error instanceof Error ? error.message : 'Please try again.', variant: 'error' });
    } finally { setSaving(false); }
  }

  async function handleReview(action: 'verify' | 'reject') {
    const reason = reviewReason.trim();
    if (action === 'reject' && !reason) {
      toast({ title: 'Rejection reason required', description: 'Record why this receipt evidence cannot be accepted.', variant: 'error' });
      return;
    }
    setReviewing(action);
    try {
      await patchAction(action, { reason: reason || undefined });
      toast({ title: action === 'verify' ? 'Receipt evidence verified' : 'Receipt evidence rejected', description: action === 'verify' ? 'The receipt and linked fuel transaction are now verified.' : 'The receipt and linked fuel transaction were rejected with the recorded reason.', variant: action === 'verify' ? 'success' : 'error' });
      setReviewReason('');
      router.refresh();
    } catch (error) {
      toast({ title: 'Unable to review receipt', description: error instanceof Error ? error.message : 'Please try again.', variant: 'error' });
    } finally { setReviewing(null); }
  }

  return (
    <div className="rounded-[8px] border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-ink-400" />
          <p className="truncate text-sm font-medium text-ink-900">{receipt.originalFileName || 'Receipt'}</p>
          <Badge variant={receipt.isVerified ? 'success' : receipt.ocrStatus === 'rejected' ? 'error' : 'pending'} size="sm">{receipt.isVerified ? 'Verified' : `OCR: ${receipt.ocrStatus.replace(/_/g, ' ')}`}</Badge>
          <Badge variant="info" size="sm">{engine}</Badge>
          {overallConfidence !== null && <Badge variant={overallConfidence >= 65 ? 'default' : 'warning'} size="sm">OCR {overallConfidence}%</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => void openOriginal()} loading={opening}><ExternalLink className="h-4 w-4" /> Original receipt</Button>
          {!readOnly && !editing && <Button variant="outline" size="sm" onClick={() => { setDraft(original); setEditing(true); }}><PencilLine className="h-4 w-4" /> Edit receipt data</Button>}
        </div>
      </div>
      <p className="mt-1 text-xs text-ink-500">Uploaded {receipt.createdAtLabel}</p>

      {flags.length > 0 && (
        <div className="mt-3 rounded-[8px] border border-status-warning-text/20 bg-status-warning-bg p-3">
          <p className="text-xs font-semibold text-status-warning-text">Validation flags</p>
          <div className="mt-2 flex flex-wrap gap-1.5">{flags.map((flag) => <Badge key={flag} variant="warning" size="sm">{flag.replaceAll('_', ' ')}</Badge>)}</div>
        </div>
      )}

      {editing ? (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FIELD_ORDER.map((field) => <FieldWrapper key={field.key} label={field.label}><Input value={draft[field.key] ?? ''} onChange={(event) => setDraft((previous) => ({ ...previous, [field.key]: event.target.value }))} inputMode={field.numeric ? 'decimal' : 'text'} autoComplete="off" placeholder={field.numeric ? '0.00' : ''} disabled={saving} /></FieldWrapper>)}
          </div>
          <p className="text-xs leading-relaxed text-ink-500">Saving corrections records the manual changes and confirms the OCR review. It does not itself verify the receipt.</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap"><Button size="sm" onClick={() => void handleSave()} loading={saving} className="w-full sm:w-auto"><Save className="h-4 w-4" /> Save corrections &amp; confirm OCR</Button><Button variant="secondary" size="sm" onClick={() => setEditing(false)} disabled={saving} className="w-full sm:w-auto"><X className="h-4 w-4" /> Cancel</Button></div>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {hasUsefulFields ? <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">{FIELD_ORDER.map((field) => { const value = fieldValue(original, field); if (!value) return null; const confidence = receipt.fieldConfidence?.[field.key]; return <div key={field.key} className="flex items-baseline justify-between gap-3 text-sm"><dt className="text-ink-500">{field.label}</dt><dd className={`text-right text-ink-950 ${field.numeric ? 'tabular-nums' : ''}`}>{value}{typeof confidence === 'number' ? <span className="ml-1 text-[10px] text-ink-400">({Math.round(confidence * 100)}%)</span> : null}</dd></div>; })}</dl> : <p className="text-sm text-ink-500">{readOnly ? 'No data was extracted from this receipt.' : 'No useful data was extracted. Use “Edit receipt data” to enter the details manually.'}</p>}
          {rawText && <details className="rounded-[8px] border border-border bg-muted/20 p-3"><summary className="cursor-pointer text-xs font-semibold text-ink-900">Raw OCR evidence</summary><pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-ink-600">{rawText}</pre></details>}
        </div>
      )}

      {canVerify && !receipt.isVerified && !editing && (
        <div className="mt-4 space-y-3 border-t border-border pt-3">
          <div><p className="text-xs font-semibold text-ink-900">Authorised receipt review</p><p className="mt-0.5 text-xs leading-5 text-ink-500">Verify only after opening the original receipt and checking it against the extracted or corrected values. Rejection requires a reason.</p></div>
          <Textarea value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} rows={2} maxLength={500} placeholder="Reviewer note / rejection reason" disabled={reviewing !== null} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap"><Button size="sm" onClick={() => void handleReview('verify')} loading={reviewing === 'verify'} disabled={reviewing !== null} className="w-full sm:w-auto"><CheckCircle2 className="h-4 w-4" /> Verify receipt &amp; transaction</Button><Button variant="destructive" size="sm" onClick={() => void handleReview('reject')} loading={reviewing === 'reject'} disabled={reviewing !== null || !reviewReason.trim()} className="w-full sm:w-auto"><XCircle className="h-4 w-4" /> Reject evidence</Button></div>
        </div>
      )}
    </div>
  );
}
