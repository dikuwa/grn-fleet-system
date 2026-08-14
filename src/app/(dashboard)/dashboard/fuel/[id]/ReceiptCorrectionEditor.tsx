'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, PencilLine, Save, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldWrapper, Input } from '@/components/ui/input';
import { useToast } from '@/lib/use-toast';

interface ReceiptLike {
  id: string;
  originalFileName: string | null;
  createdAtLabel: string;
  isVerified: boolean;
  ocrStatus: string;
  extractionData: Record<string, unknown> | null;
}

interface FieldConfig {
  key: string;
  label: string;
  numeric?: boolean;
}

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

export function ReceiptCorrectionEditor({
  receipt,
  canEdit,
}: {
  receipt: ReceiptLike;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const original = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const field of FIELD_ORDER)
      out[field.key] = stringValue(receipt.extractionData, field.key);
    return out;
  }, [receipt.extractionData]);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>(original);
  const [saving, setSaving] = useState(false);

  const readOnly = receipt.isVerified || !canEdit;
  const hasUsefulFields = FIELD_ORDER.some((field) => fieldValue(original, field) !== '');

  function updateField(key: string, value: string) {
    setDraft((previous) => ({ ...previous, [key]: value }));
  }

  function beginEdit() {
    setDraft(original);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
  }

  async function patchAction(action: string, extra: Record<string, unknown> = {}) {
    const response = await fetch('/api/fuel/receipts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiptId: receipt.id, action, ...extra }),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      throw new Error(result.error || 'Could not update receipt');
    }
  }

  async function handleSave() {
    const changes: Record<string, string | number> = {};
    for (const field of FIELD_ORDER) {
      const value = draft[field.key] ?? '';
      const originalValue = original[field.key] ?? '';
      if (value === originalValue) continue;
      const trimmed = value.trim();
      if (field.numeric && trimmed !== '' && Number.isNaN(Number(value))) {
        toast({
          title: 'Invalid number',
          description: `${field.label} must be a number.`,
          variant: 'error',
        });
        return;
      }
      changes[field.key] = field.numeric ? (trimmed === '' ? '' : Number(value)) : value;
    }

    if (Object.keys(changes).length === 0) {
      toast({
        title: 'No changes to save',
        description: 'Adjust one or more receipt fields before saving.',
        variant: 'error',
      });
      return;
    }

    setSaving(true);
    try {
      await patchAction('correct', { corrections: changes });
      await patchAction('confirm');
      toast({
        title: 'Receipt corrections saved',
        description: 'OCR confirmed. The fuel transaction remains pending verification.',
        variant: 'success',
      });
      setEditing(false);
      router.refresh();
    } catch (error) {
      toast({
        title: 'Unable to save corrections',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  function renderFields() {
    return (
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
        {FIELD_ORDER.map((field) => {
          const value = fieldValue(original, field);
          if (!value) return null;
          return (
            <div key={field.key} className="flex items-baseline justify-between gap-3 text-sm">
              <dt className="text-ink-500">{field.label}</dt>
              <dd className={`text-ink-950 ${field.numeric ? 'tabular-nums' : ''}`}>{value}</dd>
            </div>
          );
        })}
      </dl>
    );
  }

  return (
    <div className="border-border bg-surface rounded-[8px] border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="text-ink-400 h-4 w-4 shrink-0" />
          <p className="text-ink-900 truncate text-sm font-medium">
            {receipt.originalFileName || 'Receipt'}
          </p>
          <Badge variant={receipt.isVerified ? 'success' : 'pending'} size="sm">
            {receipt.isVerified ? 'Verified' : `OCR: ${receipt.ocrStatus.replace(/_/g, ' ')}`}
          </Badge>
        </div>
        {readOnly ? (
          <Badge variant="secondary" size="sm">
            Read-only
          </Badge>
        ) : editing ? null : (
          <Button variant="outline" size="sm" onClick={beginEdit}>
            <PencilLine className="h-4 w-4" />
            Edit receipt data
          </Button>
        )}
      </div>
      <p className="text-ink-500 mt-1 text-xs">Uploaded {receipt.createdAtLabel}</p>

      {editing ? (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FIELD_ORDER.map((field) => (
              <FieldWrapper key={field.key} label={field.label}>
                <Input
                  value={draft[field.key] ?? ''}
                  onChange={(event) => updateField(field.key, event.target.value)}
                  inputMode={field.numeric ? 'decimal' : 'text'}
                  autoComplete="off"
                  placeholder={field.numeric ? '0.00' : ''}
                  disabled={saving}
                  aria-label={field.label}
                />
              </FieldWrapper>
            ))}
          </div>

          <p className="text-ink-500 text-xs leading-relaxed">
            Saving corrections does not verify the fuel transaction. Final verification remains a
            separate authorised review step.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={handleSave} loading={saving} disabled={saving}>
              <Save className="h-4 w-4" />
              Save corrections &amp; confirm OCR
            </Button>
            <Button variant="secondary" size="sm" onClick={cancelEdit} disabled={saving}>
              <X className="h-4 w-4" />
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          {hasUsefulFields ? (
            renderFields()
          ) : (
            <p className="text-ink-500 text-sm">
              {readOnly
                ? 'No data was extracted from this receipt.'
                : 'No useful data was extracted. Use “Edit receipt data” to enter the details manually.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
