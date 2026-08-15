'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { StyledDateInput } from '@/components/ui/styled-select';
import { useToast } from '@/lib/use-toast';
import { AlertCircle, Camera, Loader2 } from 'lucide-react';

const FIELD_LABELS: Record<string, string> = {
  licenceNumber: 'licence number',
  licenceClass: 'licence class/codes',
  issueDate: 'valid from date',
  expiryDate: 'valid until date',
};

export function LicenceUploadPanel({ employeeId }: { employeeId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [inlineError, setInlineError] = useState('');
  const { toast } = useToast();
  const router = useRouter();

  async function upload(formData: FormData) {
    setBusy(true);
    setMissingFields([]);
    setInlineError('');
    try {
      const response = await fetch(`/api/drivers/${employeeId}/licences`, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        const missing = Array.isArray(data.missingFields)
          ? data.missingFields.filter((field: unknown): field is string => typeof field === 'string')
          : [];
        setMissingFields(missing);
        setInlineError(
          missing.length
            ? `OCR could not reliably read ${missing.map((field: string) => FIELD_LABELS[field] ?? field).join(', ')}. Complete the highlighted fallback fields and submit again.`
            : data.error || 'Unable to upload the licence.',
        );
        toast({
          title: missing.length ? 'Complete missing licence details' : 'Licence upload failed',
          description: missing.length
            ? 'The images were processed, but required values are still missing. Enter only the missing values and try again.'
            : data.error,
          variant: 'error',
        });
        return;
      }

      toast({
        title: data.manualEntryRequired ? 'Licence saved for manual review' : 'OCR complete',
        description: data.qualityWarnings?.length
          ? `Warnings: ${data.qualityWarnings.join(', ').replaceAll('_', ' ')}`
          : 'Review extracted fields before verification.',
        variant: data.qualityWarnings?.length ? 'pending' : 'success',
      });
      setOpen(false);
      setMissingFields([]);
      setInlineError('');

      // router.refresh() updates server-rendered staff screens, but Driver Self-Service
      // owns its licence list in client state. A successful renewal must be immediately
      // visible there too, otherwise a real upload looks stale until the user manually
      // reloads the page. Preserve router.refresh() for server components and perform a
      // location reload when running in the browser so all client-side licence state is
      // rebuilt from /api/drivers/me.
      router.refresh();
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to upload the licence.';
      setInlineError(message);
      toast({
        title: 'Licence upload failed',
        description: message,
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  const missing = (field: string) => missingFields.includes(field);

  return (
    <div>
      <Button size="sm" variant="secondary" onClick={() => setOpen((value) => !value)}>
        <Camera className="h-4 w-4" />
        Upload renewed licence
      </Button>
      {open && (
        <form action={upload} className="mt-4 space-y-4 rounded-[8px] border border-border bg-canvas p-4">
          {inlineError && (
            <div className="flex items-start gap-2 rounded-[8px] border border-status-error-text/20 bg-status-error-bg px-3 py-2.5" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-status-error-text" aria-hidden="true" />
              <p className="text-xs leading-5 text-status-error-text">{inlineError}</p>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5">
              <Label required>Front image</Label>
              <Input name="front" type="file" accept="image/*" capture="environment" required />
            </label>
            <label className="space-y-1.5">
              <Label required>Back image</Label>
              <Input name="back" type="file" accept="image/*" capture="environment" required />
            </label>
            <div className="space-y-1.5">
              <Label required={missing('licenceNumber')}>Licence number fallback</Label>
              <Input name="licenceNumber" aria-invalid={missing('licenceNumber') || undefined} />
              {missing('licenceNumber') && <p className="text-xs text-status-error-text">Required because OCR did not read this value.</p>}
            </div>
            <div className="space-y-1.5">
              <Label required={missing('licenceClass')}>Licence codes fallback</Label>
              <Input name="licenceClass" placeholder="B, C1" aria-invalid={missing('licenceClass') || undefined} />
              {missing('licenceClass') && <p className="text-xs text-status-error-text">Required because OCR did not read this value.</p>}
            </div>
            <div className="space-y-1.5">
              <Label required={missing('issueDate')}>Valid from fallback</Label>
              <StyledDateInput name="issueDate" type="date" aria-invalid={missing('issueDate') || undefined} />
              {missing('issueDate') && <p className="text-xs text-status-error-text">Required because OCR did not read this date.</p>}
            </div>
            <div className="space-y-1.5">
              <Label required={missing('expiryDate')}>Valid until fallback</Label>
              <StyledDateInput name="expiryDate" type="date" aria-invalid={missing('expiryDate') || undefined} />
              {missing('expiryDate') && <p className="text-xs text-status-error-text">Required because OCR did not read this date.</p>}
            </div>
          </div>
          <p className="text-xs text-ink-500">
            Original files are preserved. OCR suggestions remain unverified until an authorised reviewer confirms them. Fallback values are used only when OCR cannot reliably extract a required field.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" disabled={busy} className="w-full sm:w-auto">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Upload and run OCR
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
