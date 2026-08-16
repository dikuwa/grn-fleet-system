'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { StyledDateInput, StyledSelect } from '@/components/ui/styled-select';
import { useToast } from '@/lib/use-toast';
import { VEHICLE_DOCUMENT_LABELS, VEHICLE_DOCUMENT_TYPES } from '@/lib/vehicle-documents';

export function VehicleDocumentUpload({ vehicleId }: { vehicleId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState('registration');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [notes, setNotes] = useState('');

  const reset = () => {
    setFile(null);
    setDocumentType('registration');
    setReferenceNumber('');
    setIssueDate('');
    setExpiryDate('');
    setNotes('');
  };

  const save = async () => {
    if (!file) return;
    setSaving(true);
    try {
      const uploadBody = new FormData();
      uploadBody.append('file', file);
      uploadBody.append('category', 'document');
      const uploadResponse = await fetch('/api/upload', { method: 'POST', body: uploadBody });
      const uploaded = await uploadResponse.json().catch(() => ({}));
      if (!uploadResponse.ok || !uploaded.data?.key) throw new Error(uploaded.error || 'File upload failed');

      const response = await fetch(`/api/fleet/${vehicleId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentType,
          documentName: file.name,
          referenceNumber,
          issueDate: issueDate || null,
          expiryDate: expiryDate || null,
          notes,
          fileKey: uploaded.data.key,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Document record could not be saved');
      toast({ title: 'Vehicle document saved', description: `${VEHICLE_DOCUMENT_LABELS[documentType]} added; earlier versions remain available.`, variant: 'success' });
      setOpen(false);
      reset();
      router.refresh();
    } catch (error) {
      toast({ title: 'Vehicle document not saved', description: error instanceof Error ? error.message : 'Please try again.', variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}><FileUp className="h-4 w-4" /> Add Document</Button>
      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add vehicle document</DialogTitle>
            <DialogDescription>Upload a new current version. Existing records and files are retained as document history.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs font-medium text-ink-500">Document type
              <StyledSelect value={documentType} onChange={(event) => setDocumentType(event.target.value)}>
                {VEHICLE_DOCUMENT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </StyledSelect>
            </label>
            <label className="space-y-1.5 text-xs font-medium text-ink-500">Reference / document number
              <Input value={referenceNumber} onChange={(event) => setReferenceNumber(event.target.value)} placeholder="Optional" />
            </label>
            <label className="space-y-1.5 text-xs font-medium text-ink-500">Issue date
              <StyledDateInput value={issueDate} onChange={(event) => setIssueDate(event.target.value)} />
            </label>
            <label className="space-y-1.5 text-xs font-medium text-ink-500">Expiry date
              <StyledDateInput value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} />
            </label>
            <label className="space-y-1.5 text-xs font-medium text-ink-500 sm:col-span-2">File <span className="text-status-error-text">*</span>
              <input type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] || null)} className="focus-ring border-border bg-surface text-ink-700 file:bg-muted file:text-ink-700 h-11 w-full rounded-[8px] border px-2 py-1.5 text-sm file:mr-3 file:rounded-[6px] file:border-0 file:px-3 file:py-1.5" />
            </label>
            <label className="space-y-1.5 text-xs font-medium text-ink-500 sm:col-span-2">Notes
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="focus-ring border-border bg-surface text-ink-950 w-full resize-y rounded-[8px] border px-3 py-2 text-sm" placeholder="Optional context" />
            </label>
          </div>
          <DialogFooter className="mobile-action-bar">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} loading={saving} disabled={!file}>Upload Document</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
