'use client';

import { useEffect, useState } from 'react';
import { Camera, Plus, Receipt, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/input';
import { StyledSelect } from '@/components/ui/styled-select';
import { useToast } from '@/lib/use-toast';

const DRIVER_EXPENSE_CATEGORIES = [
  ['parking', 'Parking'],
  ['toll', 'Toll / road fee'],
  ['car_wash', 'Car wash'],
  ['minor_consumables', 'Minor consumables'],
  ['emergency_repair', 'Emergency repair'],
  ['tyre_service', 'Tyre service'],
  ['accommodation', 'Accommodation'],
  ['driver_subsistence', 'Driver subsistence'],
  ['other', 'Other'],
] as const;

const EMPTY = {
  category: 'parking',
  supplier: '',
  transactionAt: '',
  referenceNumber: '',
  amount: '',
  odometerReading: '',
  notes: '',
};

export function DriverExpenseCapture({ tripId }: { tripId: string }) {
  const { toast } = useToast();
  const [tripStatus, setTripStatus] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/trips/${tripId}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = (await response.json().catch(() => null)) as {
          trip?: { status?: string };
        } | null;
        if (!controller.signal.aborted) setTripStatus(payload?.trip?.status ?? null);
      } catch (error) {
        if ((error as Error)?.name !== 'AbortError') setTripStatus(null);
      }
    })();
    return () => controller.abort();
  }, [tripId]);

  function close() {
    if (saving) return;
    setOpen(false);
    setForm(EMPTY);
    setReceiptFile(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      let receiptKey: string | undefined;
      if (receiptFile) {
        const upload = new FormData();
        upload.append('file', receiptFile);
        upload.append('tripId', tripId);
        const receiptResponse = await fetch('/api/expenses/receipts', {
          method: 'POST',
          body: upload,
        });
        const receiptJson = await receiptResponse.json();
        if (!receiptResponse.ok) {
          throw new Error(receiptJson.error || 'Could not upload the receipt');
        }
        receiptKey = receiptJson.data?.key;
      }

      const response = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tripId,
          category: form.category,
          supplier: form.supplier || undefined,
          transactionAt: form.transactionAt,
          referenceNumber: form.referenceNumber || undefined,
          amount: form.amount,
          currency: 'NAD',
          odometerReading: form.odometerReading || undefined,
          notes: form.notes || undefined,
          receiptKey,
          clientSyncId: crypto.randomUUID(),
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Could not record the trip expense');

      toast({
        title: 'Trip expense recorded',
        description: 'The cost and any receipt are now available to Transport Office for verification.',
        variant: 'success',
      });
      close();
    } catch (error) {
      toast({
        title: 'Unable to record expense',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  // Match the server contract exactly. Driver expenses are operational capture,
  // not historical trip editing, so returned/reconciliation/closed records stay
  // read-only even though the Driver may still view their assigned trip.
  if (!tripStatus || !['in_progress', 'return_due'].includes(tripStatus)) return null;

  if (!open) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-ink-950">Trip operating expense</p>
            <p className="mt-1 text-xs text-ink-500">
              Record parking, tolls, a car wash or another legitimate cost during this assigned trip.
              Fuel remains under My Fuel Entries.
            </p>
          </div>
          <Button size="sm" type="button" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Record expense
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>Trip operating expense</CardTitle>
          <p className="mt-1 text-xs text-ink-500">
            This expense is linked automatically to your assigned trip and vehicle.
          </p>
        </div>
        <Button variant="ghost" size="sm" type="button" onClick={close} disabled={saving}>
          <X className="h-4 w-4" /> Close
        </Button>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label required>Category</Label>
              <StyledSelect
                value={form.category}
                onChange={(event) => setForm((value) => ({ ...value, category: event.target.value }))}
              >
                {DRIVER_EXPENSE_CATEGORIES.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </StyledSelect>
            </div>
            <div className="space-y-1.5">
              <Label required>Date & time</Label>
              <Input
                type="datetime-local"
                value={form.transactionAt}
                onChange={(event) => setForm((value) => ({ ...value, transactionAt: event.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label required>Amount (NAD)</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={form.amount}
                onChange={(event) => setForm((value) => ({ ...value, amount: event.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Odometer</Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={form.odometerReading}
                onChange={(event) => setForm((value) => ({ ...value, odometerReading: event.target.value }))}
                placeholder="km"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Supplier / service provider</Label>
              <Input
                value={form.supplier}
                onChange={(event) => setForm((value) => ({ ...value, supplier: event.target.value }))}
                placeholder="e.g. car wash, parking facility"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Receipt / invoice reference</Label>
              <Input
                value={form.referenceNumber}
                onChange={(event) => setForm((value) => ({ ...value, referenceNumber: event.target.value }))}
                placeholder="Optional reference"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Reason / notes</Label>
            <Textarea
              value={form.notes}
              onChange={(event) => setForm((value) => ({ ...value, notes: event.target.value }))}
              placeholder="Why was this expense necessary?"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Receipt / proof</Label>
            <label className="flex min-h-20 cursor-pointer items-center justify-center gap-2 rounded-[8px] border border-dashed border-border bg-canvas px-4 py-3 text-sm text-ink-700 hover:border-brand-400">
              <Camera className="h-5 w-5 text-brand-700" />
              {receiptFile ? receiptFile.name : 'Take photo or choose receipt / PDF'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                capture="environment"
                className="sr-only"
                onChange={(event) => setReceiptFile(event.target.files?.[0] || null)}
              />
            </label>
          </div>

          <div className="rounded-[8px] border border-border bg-muted/30 px-3 py-2 text-xs text-ink-600">
            <span className="inline-flex items-center gap-1 font-medium text-ink-800">
              <Receipt className="h-3.5 w-3.5" /> Record keeping
            </span>{' '}
            Transport Office can verify this expense later. Recording it does not approve reimbursement or maintenance work.
          </div>

          <Button type="submit" size="sm" loading={saving} disabled={saving}>
            Save trip expense
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
