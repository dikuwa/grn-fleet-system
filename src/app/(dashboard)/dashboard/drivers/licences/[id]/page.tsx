'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Label } from '@/components/ui/input';
import { StyledDateInput } from '@/components/ui/styled-select';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Loader2,
  AlertCircle,
  ShieldCheck,
  ShieldAlert,
  FileSearch,
  ImageIcon,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ArrowLeftRight,
  History,
  Camera,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';

interface ReviewLicence {
  id: string;
  version: number;
  licenceNumber: string;
  licenceClass: string;
  issueDate: string;
  expiryDate: string;
  holderName: string | null;
  dateOfBirth: string | null;
  nationalIdNumber: string | null;
  driverRestrictionCode: string | null;
  issueNumber: string | null;
  verificationStatus: string;
  isActive: boolean;
  isVerified: boolean;
  rejectionReason: string | null;
  notes: string | null;
  ocrConfidence: Record<string, number> | null;
  ocrText: string | null;
  extracted: Record<string, string | string[] | null> | null;
  createdAt: string;
}

interface CurrentVerified {
  id: string;
  version: number;
  licenceNumber: string;
  licenceClass: string;
  issueDate: string;
  expiryDate: string;
  frontUrl: string | null;
}

interface DriverInfo {
  employeeId: string;
  employeeNumber: string;
  name: string;
  jobTitle: string | null;
  departmentName: string | null;
  officeName: string | null;
  employmentStatus: string;
  driverStatus: string;
  availabilityStatus: string;
}

interface ReviewPayload {
  licence: ReviewLicence;
  codes: string[];
  corrections: Array<{ fieldName: string; originalValue: string | null; correctedValue: string; source: string }>;
  driver: DriverInfo;
  currentVerified: CurrentVerified | null;
  previousVersions: Array<{ id: string; version: number; verificationStatus: string; isActive: boolean; licenceClass: string; expiryDate: string }>;
  files: { frontUrl: string | null; backUrl: string | null; pdfUrl: string | null };
  warnings: string[];
}

function warningLabel(code: string): string {
  const labels: Record<string, string> = {
    dark_image: 'Image too dark for OCR',
    possible_glare: 'Possible glare on image',
    ocr_failed_manual_entry_required: 'OCR failed — manual entry required',
    licence_number_mismatch: 'Licence number differs from current verified record',
    licence_class_changed: 'Licence class differs from current verified record',
    issue_date_in_future: 'Issue date is in the future',
    expiry_date_passed: 'Expiry date has already passed',
  };
  return labels[code] ?? code.replaceAll('_', ' ');
}

export default function LicenceReviewPage() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const licenceId = typeof params?.id === 'string' ? params.id : '';

  const [data, setData] = useState<ReviewPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Final verified values (pre-filled from the licence; reviewer may correct).
  const [confirmedValues, setConfirmedValues] = useState({
    licenceNumber: '',
    licenceClass: '',
    issueDate: '',
    expiryDate: '',
    holderName: '',
  });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'approve' | 'request_upload' | 'reject' | null>(null);
  const [confirmAction, setConfirmAction] = useState<'approve' | 'reject' | null>(null);
  const [zoomImage, setZoomImage] = useState<string | null>(null);

  const initialLoadRef = useRef(false);

  const fetchReview = useCallback(async () => {
    if (!licenceId) return;
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/drivers/licences/${licenceId}/review`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load licence review');
      setData(json.data);
      const licence = json.data.licence as ReviewLicence;
      setConfirmedValues({
        licenceNumber: licence.licenceNumber.startsWith('PENDING-') ? '' : licence.licenceNumber,
        licenceClass: licence.licenceClass.startsWith('PENDING') ? '' : licence.licenceClass,
        issueDate: licence.issueDate || '',
        expiryDate: licence.expiryDate || '',
        holderName: licence.holderName ?? '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load licence review');
    } finally {
      setIsLoading(false);
    }
  }, [licenceId]);

  useEffect(() => {
    if (!initialLoadRef.current) {
      initialLoadRef.current = true;
      void fetchReview();
    }
  }, [fetchReview]);

  const runAction = useCallback(
    async (action: 'approve' | 'request_upload' | 'reject') => {
      if (!data) return;
      if ((action === 'request_upload' || action === 'reject') && !reason.trim()) {
        toast({ title: 'A reason is required', description: 'Provide a clear reason for this action.', variant: 'error' });
        return;
      }
      setBusy(action);
      try {
        if (action === 'approve') {
          // Approve via PATCH on the driver licence route (atomic: corrections +
          // supersede previous versions + notify driver).
          const corrections: Record<string, string> = {};
          if (confirmedValues.licenceNumber && confirmedValues.licenceNumber !== data.licence.licenceNumber) corrections.licenceNumber = confirmedValues.licenceNumber;
          if (confirmedValues.licenceClass && confirmedValues.licenceClass !== data.licence.licenceClass) corrections.licenceClass = confirmedValues.licenceClass;
          if (confirmedValues.issueDate && confirmedValues.issueDate !== data.licence.issueDate) corrections.issueDate = confirmedValues.issueDate;
          if (confirmedValues.expiryDate && confirmedValues.expiryDate !== data.licence.expiryDate) corrections.expiryDate = confirmedValues.expiryDate;
          if (confirmedValues.holderName && confirmedValues.holderName !== (data.licence.holderName ?? '')) corrections.holderName = confirmedValues.holderName;

          const res = await fetch(`/api/drivers/${data.driver.employeeId}/licences`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licenceId: data.licence.id, action: 'approve', corrections: Object.keys(corrections).length ? corrections : undefined }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || 'Failed to approve licence');
          toast({ title: 'Licence approved', description: 'The renewal is now the active verified licence.', variant: 'success' });
        } else {
          const res = await fetch(`/api/drivers/licences/${data.licence.id}/review`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, reason: reason.trim() }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || 'Failed to update licence');
          toast({
            title: action === 'reject' ? 'Licence rejected' : 'Changes requested',
            description: 'The driver has been notified.',
            variant: action === 'reject' ? 'error' : 'pending',
          });
        }
        setConfirmAction(null);
        setReason('');
        await fetchReview();
      } catch (err) {
        toast({
          title: 'Action failed',
          description: err instanceof Error ? err.message : 'An unexpected error occurred',
          variant: 'error',
        });
      } finally {
        setBusy(null);
      }
    },
    [data, confirmedValues, reason, toast, fetchReview],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="text-ink-400 h-7 w-7 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Licence Review" />
        <Card>
          <CardContent className="pt-6">
            <div className="text-status-error-text flex flex-col items-center gap-3 py-10 text-center">
              <AlertCircle className="h-8 w-8" />
              <p className="text-sm">{error || 'Licence record not found'}</p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => void fetchReview()}>
                  <RefreshCw className="h-4 w-4" /> Retry
                </Button>
                <Button variant="secondary" size="sm" asChild>
                  <Link href="/dashboard/drivers/licences">Back to queue</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { licence, driver, currentVerified, files, warnings, corrections, previousVersions } = data;
  const isBlocked = licence.verificationStatus === 'verified' || licence.verificationStatus === 'expired' || licence.verificationStatus === 'superseded';

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Drivers', href: '/dashboard/drivers' },
          { label: 'Licence Verification', href: '/dashboard/drivers/licences' },
          { label: `v${licence.version}` },
        ]}
      />
      <PageHeader
        title={`Licence Review · v${licence.version}`}
        description={`${driver.name} · ${driver.employeeNumber}`}
      >
        <div className="flex items-center gap-2">
          <StatusBadge
            status={licence.verificationStatus === 'verified' ? 'success' : licence.verificationStatus === 'rejected' || licence.verificationStatus === 'expired' ? 'error' : licence.verificationStatus === 'superseded' ? 'default' : 'pending'}
            label={licence.verificationStatus.replace(/_/g, ' ')}
          />
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/drivers/licences">Back to queue</Link>
          </Button>
        </div>
      </PageHeader>

      {warnings.length > 0 && (
        <div className="rounded-[10px] border border-status-warning-bg bg-status-warning-bg/10 p-4">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0 text-status-warning-text" />
            <p className="text-sm font-medium text-status-warning-text">Review warnings</p>
          </div>
          <ul className="mt-2 space-y-1">
            {warnings.map((warning, index) => (
              <li key={index} className="text-xs text-ink-600">• {warningLabel(warning)}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Driver identity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-ink-400" /> Driver
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-xs text-ink-500">Name</p>
              <p className="text-sm font-medium text-ink-950">{driver.name}</p>
            </div>
            <div>
              <p className="text-xs text-ink-500">Employee number</p>
              <p className="text-sm font-medium text-ink-950">{driver.employeeNumber}</p>
            </div>
            <div>
              <p className="text-xs text-ink-500">Staff status</p>
              <StatusBadge status={driver.employmentStatus === 'active' ? 'success' : 'error'} label={driver.employmentStatus} />
            </div>
            <div>
              <p className="text-xs text-ink-500">Driver status</p>
              <StatusBadge status={driver.driverStatus === 'authorised' ? 'success' : driver.driverStatus === 'suspended' ? 'pending' : 'error'} label={driver.driverStatus.replace(/_/g, ' ')} />
            </div>
            <div>
              <p className="text-xs text-ink-500">Availability</p>
              <StatusBadge status={driver.availabilityStatus === 'available' ? 'success' : 'pending'} label={driver.availabilityStatus.replace(/_/g, ' ')} />
            </div>
            <div>
              <p className="text-xs text-ink-500">Department / Office</p>
              <p className="text-sm text-ink-700">{driver.departmentName ?? '—'} / {driver.officeName ?? '—'}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Documents */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-ink-400" /> Submitted documents
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            {files.frontUrl ? (
              <button type="button" onClick={() => setZoomImage(files.frontUrl)} className="focus-ring group relative overflow-hidden rounded-[10px] border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={files.frontUrl} alt="Licence front" className="h-48 w-full object-cover transition-transform group-hover:scale-[1.02]" />
                <span className="absolute right-2 bottom-2 rounded-[6px] bg-ink-950/70 px-2 py-0.5 text-[10px] font-medium text-white">Front · click to zoom</span>
              </button>
            ) : (
              <div className="flex h-48 flex-col items-center justify-center rounded-[10px] border border-dashed border-border bg-muted/30 text-ink-400">
                <ImageIcon className="h-8 w-8" />
                <p className="mt-2 text-xs">No front image</p>
              </div>
            )}
            {files.backUrl ? (
              <button type="button" onClick={() => setZoomImage(files.backUrl)} className="focus-ring group relative overflow-hidden rounded-[10px] border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={files.backUrl} alt="Licence back" className="h-48 w-full object-cover transition-transform group-hover:scale-[1.02]" />
                <span className="absolute right-2 bottom-2 rounded-[6px] bg-ink-950/70 px-2 py-0.5 text-[10px] font-medium text-white">Back · click to zoom</span>
              </button>
            ) : (
              <div className="flex h-48 flex-col items-center justify-center rounded-[10px] border border-dashed border-border bg-muted/30 text-ink-400">
                <ImageIcon className="h-8 w-8" />
                <p className="mt-2 text-xs">No back image</p>
              </div>
            )}
          </div>
          {files.pdfUrl && (
            <a href={files.pdfUrl} target="_blank" rel="noreferrer" className="text-brand-700 mt-3 inline-flex items-center gap-1 text-xs font-medium hover:underline">
              <FileSearch className="h-3.5 w-3.5" /> Open source PDF
            </a>
          )}
        </CardContent>
      </Card>

      {/* Compare current verified */}
      {currentVerified && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4 text-ink-400" /> Current verified licence (v{currentVerified.version})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-ink-500">Number</p>
                <p className="text-sm font-medium text-ink-950">{currentVerified.licenceNumber}</p>
              </div>
              <div>
                <p className="text-xs text-ink-500">Class</p>
                <p className="text-sm font-medium text-ink-950">{currentVerified.licenceClass}</p>
              </div>
              <div>
                <p className="text-xs text-ink-500">Issue date</p>
                <p className="text-sm text-ink-700">{currentVerified.issueDate}</p>
              </div>
              <div>
                <p className="text-xs text-ink-500">Expiry date</p>
                <p className="text-sm text-ink-700">{currentVerified.expiryDate}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* OCR + confirmed values */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSearch className="h-4 w-4 text-ink-400" /> OCR extraction & final values
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-[8px] border border-border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="info" size="sm">OCR provider: {licence.ocrConfidence ? 'tesseract.js' : 'manual'}</Badge>
              {licence.ocrConfidence && (
                <Badge variant="default" size="sm">
                  Confidence: {Math.round(Object.values(licence.ocrConfidence).filter((v): v is number => typeof v === 'number').reduce((sum, value) => sum + value, 0) / Math.max(1, Object.values(licence.ocrConfidence).length))}%
                </Badge>
              )}
            </div>
            <p className="text-ink-500 mt-2 text-xs">
              OCR output is provisional. Confirm or correct the final verified values below before approving.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label required>Licence number (verified)</Label>
              <Input value={confirmedValues.licenceNumber} onChange={(e) => setConfirmedValues((v) => ({ ...v, licenceNumber: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label required>Licence class (verified)</Label>
              <Input value={confirmedValues.licenceClass} onChange={(e) => setConfirmedValues((v) => ({ ...v, licenceClass: e.target.value }))} placeholder="B, C1" />
            </div>
            <div className="space-y-1.5">
              <Label required>Issue date</Label>
              <StyledDateInput type="date" value={confirmedValues.issueDate} onChange={(e) => setConfirmedValues((v) => ({ ...v, issueDate: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label required>Expiry date</Label>
              <StyledDateInput type="date" value={confirmedValues.expiryDate} onChange={(e) => setConfirmedValues((v) => ({ ...v, expiryDate: e.target.value }))} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Holder name</Label>
              <Input value={confirmedValues.holderName} onChange={(e) => setConfirmedValues((v) => ({ ...v, holderName: e.target.value }))} />
            </div>
          </div>

          {corrections.length > 0 && (
            <div>
              <p className="text-xs font-medium text-ink-500">Corrections already applied</p>
              <div className="mt-2 space-y-1">
                {corrections.map((correction, index) => (
                  <p key={index} className="text-xs text-ink-600">
                    {correction.fieldName}: <span className="line-through opacity-60">{correction.originalValue || '—'}</span> → <span className="font-medium">{correction.correctedValue}</span>
                  </p>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-ink-400" /> Version history
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {previousVersions.length === 0 ? (
              <p className="text-xs text-ink-500">No other licence versions on record.</p>
            ) : (
              previousVersions.map((version) => (
                <div key={version.id} className="flex items-center justify-between rounded-[8px] border border-border bg-muted/30 px-3 py-2">
                  <div className="flex items-center gap-3">
                    <Badge variant="default" size="sm">v{version.version}</Badge>
                    <p className="text-sm text-ink-700">Class {version.licenceClass} · expires {version.expiryDate}</p>
                  </div>
                  <StatusBadge
                    status={version.isActive ? 'success' : version.verificationStatus === 'superseded' ? 'default' : 'pending'}
                    label={version.isActive ? 'Active' : version.verificationStatus.replace(/_/g, ' ')}
                  />
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      {!isBlocked && (
        <Card>
          <CardHeader>
            <CardTitle>Review decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Reason / reviewer note</Label>
              <Textarea
                placeholder="Required for Request Changes and Reject; optional note for approval."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                loading={busy === 'approve'}
                disabled={!confirmedValues.licenceNumber || !confirmedValues.licenceClass || !confirmedValues.expiryDate}
                onClick={() => setConfirmAction('approve')}
              >
                <CheckCircle2 className="h-4 w-4" /> Approve renewal
              </Button>
              <Button
                variant="secondary"
                size="sm"
                loading={busy === 'request_upload'}
                disabled={!reason.trim()}
                onClick={() => void runAction('request_upload')}
              >
                <RefreshCw className="h-4 w-4" /> Request changes
              </Button>
              <Button
                variant="destructive"
                size="sm"
                loading={busy === 'reject'}
                disabled={!reason.trim()}
                onClick={() => setConfirmAction('reject')}
              >
                <XCircle className="h-4 w-4" /> Reject
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title={confirmAction === 'approve' ? 'Approve licence renewal?' : 'Reject licence renewal?'}
        description={
          confirmAction === 'approve'
            ? 'The renewal will become the active verified licence. The previous version will be marked superseded and the driver notified.'
            : 'The renewal will be rejected and the driver notified. The current verified licence is preserved.'
        }
        confirmLabel={confirmAction === 'approve' ? 'Approve' : 'Reject'}
        variant={confirmAction === 'approve' ? 'default' : 'destructive'}
        onConfirm={() => {
          if (confirmAction) void runAction(confirmAction);
        }}
      />

      {zoomImage && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-ink-950/80 p-6"
          onClick={() => setZoomImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Zoomed licence image"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoomImage} alt="Zoomed licence" className="max-h-full max-w-full rounded-[10px] object-contain shadow-2xl" />
          <button type="button" onClick={() => setZoomImage(null)} className="absolute top-4 right-4 rounded-[8px] bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20">
            Close
          </button>
        </div>
      )}
    </div>
  );
}
