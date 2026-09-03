'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, FileUp, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { StyledDateInput, StyledSelect } from '@/components/ui/styled-select';
import { useToast } from '@/lib/use-toast';
import { VEHICLE_DOCUMENT_LABELS, VEHICLE_DOCUMENT_TYPES } from '@/lib/vehicle-documents';

interface PendingVehicleDocument {
  id: string;
  documentType: string;
  documentName: string;
  referenceNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  fileKey: string | null;
  isVerified: boolean;
  updatedAt: string;
}

export function VehicleDocumentUpload({ vehicleId }: { vehicleId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingReview, setLoadingReview] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [pendingDocuments, setPendingDocuments] = useState<PendingVehicleDocument[]>([]);
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

  const loadPendingDocuments = async () => {
    setLoadingReview(true);
    try {
      const response = await fetch(`/api/fleet/${vehicleId}/documents`, { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Document review could not be loaded');
      setPendingDocuments(Array.isArray(json.documents) ? json.documents : []);
    } catch (error) {
      toast({
        title: 'Document review not loaded',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'error',
      });
      setPendingDocuments([]);
    } finally {
      setLoadingReview(false);
    }
  };

  const openReview = async () => {
    setReviewOpen(true);
    await loadPendingDocuments();
  };

  const verifyDocument = async (document: PendingVehicleDocument) => {
    setVerifyingId(document.id);
    try {
      const response = await fetch(
        `/api/fleet/${vehicleId}/documents/${document.id}/verify`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedUpdatedAt: document.updatedAt }),
        },
      );
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Document could not be verified');
      setPendingDocuments((current) => current.filter((item) => item.id !== document.id));
      toast({
        title: 'Vehicle document verified',
        description: `${VEHICLE_DOCUMENT_LABELS[document.documentType] || document.documentName} is now trusted for compliance review.`,
        variant: 'success',
      });
      router.refresh();
    } catch (error) {
      toast({
        title: 'Document not verified',
        description: error instanceof Error ? error.message : 'Please refresh and try again.',
        variant: 'error',
      });
      await loadPendingDocuments();
    } finally {
      setVerifyingId(null);
    }
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
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={openReview}>
          <ShieldCheck className="h-4 w-4" /> Review Documents
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <FileUp className="h-4 w-4" /> Add Document
        </Button>
      </div>

      <Dialog open={reviewOpen} onOpenChange={(next) => !verifyingId && setReviewOpen(next)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review vehicle documents</DialogTitle>
            <DialogDescription>
              Open each uploaded file and verify it only after the document details and evidence have been checked. Verified evidence can be used by compliance reporting.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] space-y-2 overflow-y-auto">
            {loadingReview ? (
              <p className="py-6 text-center text-sm text-ink-500">Loading documents…</p>
            ) : pendingDocuments.length === 0 ? (
              <div className="rounded-[8px] border border-border bg-canvas px-4 py-6 text-center">
                <ShieldCheck className="mx-auto mb-2 h-5 w-5 text-status-success-text" />
                <p className="text-sm font-medium text-ink-700">No documents awaiting verification</p>
              </div>
            ) : (
              pendingDocuments.map((document) => (
                <div key={document.id} className="rounded-[8px] border border-border bg-surface p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-950">{document.documentName}</p>
                      <p className="mt-1 text-xs text-ink-500">
                        {VEHICLE_DOCUMENT_LABELS[document.documentType] || document.documentType.replace(/_/g, ' ')}
                        {document.referenceNumber ? ` · ${document.referenceNumber}` : ''}
                        {document.expiryDate ? ` · Expires ${document.expiryDate}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {document.fileKey && (
                        <Button variant="tertiary" size="sm" asChild>
                          <a
                            href={`/api/files?key=${encodeURIComponent(document.fileKey)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="h-3.5 w-3.5" /> Open
                          </a>
                        </Button>
                      )}
                      <Button
                        variant="primary"
                        size="sm"
                        loading={verifyingId === document.id}
                        disabled={Boolean(verifyingId) || !document.fileKey}
                        onClick={() => verifyDocument(document)}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" /> Verify
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter className="mobile-action-bar">
            <Button variant="secondary" onClick={() => setReviewOpen(false)} disabled={Boolean(verifyingId)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
