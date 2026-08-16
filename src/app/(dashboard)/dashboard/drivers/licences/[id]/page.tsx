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
  AlertCircle,
  ArrowLeftRight,
  Camera,
  CheckCircle2,
  Eye,
  FileSearch,
  History,
  ImageIcon,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  XCircle,
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
  ocrProvider: string | null;
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
  backUrl: string | null;
  pdfUrl: string | null;
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

interface DuplicateLicence {
  employeeId: string;
  employeeNumber: string;
  driverName: string;
}

interface ReviewPayload {
  canReview: boolean;
  licence: ReviewLicence;
  codes: string[];
  corrections: Array<{
    fieldName: string;
    originalValue: string | null;
    correctedValue: string;
    source: string;
  }>;
  driver: DriverInfo;
  duplicateLicence: DuplicateLicence | null;
  currentVerified: CurrentVerified | null;
  previousVersions: Array<{
    id: string;
    version: number;
    verificationStatus: string;
    isActive: boolean;
    licenceClass: string;
    expiryDate: string;
  }>;
  files: { frontUrl: string | null; backUrl: string | null; pdfUrl: string | null };
  warnings: string[];
}

function warningLabel(code: string): string {
  const labels: Record<string, string> = {
    dark_image: 'Image too dark for OCR',
    possible_glare: 'Possible glare on image',
    ocr_failed_manual_entry_required: 'OCR failed — manual entry required',
    duplicate_licence_number: 'Licence number is already verified for another driver',
    licence_number_mismatch: 'Licence number differs from current verified record',
    licence_class_changed: 'Licence class differs from current verified record',
    issue_date_in_future: 'Issue date is in the future',
    expiry_date_passed: 'Expiry date has already passed',
  };
  return labels[code] ?? code.replaceAll('_', ' ');
}

function averageOcrConfidence(confidence: Record<string, number> | null): number | null {
  if (!confidence) return null;
  const values = Object.values(confidence).filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  if (!values.length) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.round(average <= 1 ? average * 100 : average);
}

function displayOcrValue(value: string | string[] | null): string {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ') || '—';
  return value?.trim() || '—';
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-ink-500 text-xs font-medium">{label}</p>
      <div className="text-ink-800 mt-1 min-w-0 break-words text-sm">{value}</div>
    </div>
  );
}

export default function LicenceReviewPage() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const licenceId = typeof params?.id === 'string' ? params.id : '';

  const [data, setData] = useState<ReviewPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
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
      if (!data?.canReview) {
        toast({
          title: 'Read-only licence oversight',
          description: 'Switch to the Transport Administration workspace to review licence submissions.',
          variant: 'error',
        });
        return;
      }
      if ((action === 'request_upload' || action === 'reject') && !reason.trim()) {
        toast({
          title: 'A reason is required',
          description: 'Provide a clear reason for this action.',
          variant: 'error',
        });
        return;
      }
      setBusy(action);
      try {
        if (action === 'approve') {
          const corrections: Record<string, string> = {};
          if (confirmedValues.licenceNumber && confirmedValues.licenceNumber !== data.licence.licenceNumber)
            corrections.licenceNumber = confirmedValues.licenceNumber;
          if (confirmedValues.licenceClass && confirmedValues.licenceClass !== data.licence.licenceClass)
            corrections.licenceClass = confirmedValues.licenceClass;
          if (confirmedValues.issueDate && confirmedValues.issueDate !== data.licence.issueDate)
            corrections.issueDate = confirmedValues.issueDate;
          if (confirmedValues.expiryDate && confirmedValues.expiryDate !== data.licence.expiryDate)
            corrections.expiryDate = confirmedValues.expiryDate;
          if (confirmedValues.holderName && confirmedValues.holderName !== (data.licence.holderName ?? ''))
            corrections.holderName = confirmedValues.holderName;

          const res = await fetch(`/api/drivers/${data.driver.employeeId}/licences`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              licenceId: data.licence.id,
              action: 'approve',
              corrections: Object.keys(corrections).length ? corrections : undefined,
            }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || 'Failed to approve licence');
          toast({
            title: 'Licence approved',
            description: 'The renewal is now the active verified licence.',
            variant: 'success',
          });
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
      <div className="text-ink-500 flex min-h-56 items-center justify-center gap-2 py-16 text-sm" role="status">
        <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Loading licence record…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-5 sm:space-y-6">
        <PageHeader title="Licence Review" />
        <Card>
          <CardContent className="py-10 sm:py-12">
            <div className="text-status-error-text flex flex-col items-center gap-3 text-center">
              <AlertCircle className="h-8 w-8" aria-hidden="true" />
              <p className="max-w-md text-sm">{error || 'Licence record not found'}</p>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
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

  const {
    canReview,
    licence,
    driver,
    duplicateLicence,
    currentVerified,
    files,
    warnings,
    corrections,
    previousVersions,
  } = data;
  const isBlocked = ['verified', 'expired', 'superseded'].includes(licence.verificationStatus);
  const ocrConfidencePercent = averageOcrConfidence(licence.ocrConfidence);
  const extractedOcrEntries = Object.entries(licence.extracted ?? {}).filter(([, value]) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value),
  );

  return (
    <div className="space-y-5 sm:space-y-6">
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
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <StatusBadge
            status={
              licence.verificationStatus === 'verified'
                ? 'success'
                : licence.verificationStatus === 'rejected' || licence.verificationStatus === 'expired'
                  ? 'error'
                  : licence.verificationStatus === 'superseded'
                    ? 'default'
                    : 'pending'
            }
            label={licence.verificationStatus.replace(/_/g, ' ')}
          />
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/drivers/licences">Back to queue</Link>
          </Button>
        </div>
      </PageHeader>

      {!canReview && (
        <div className="border-border bg-muted/30 flex flex-col gap-3 rounded-[10px] border px-4 py-3 sm:flex-row sm:items-start">
          <Eye className="text-brand-700 mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-ink-950 text-sm font-semibold">Read-only licence oversight</p>
            <p className="text-ink-500 mt-1 text-xs leading-5">
              Tenant Administration can inspect licence submissions, expiry risk, OCR output and review history. Approval, rejection and change requests are performed in the Transport Administration workspace.
            </p>
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="border-status-warning-text/20 bg-status-warning-bg rounded-[10px] border px-4 py-3 sm:p-4" role="alert">
          <div className="flex items-start gap-2">
            <ShieldAlert className="text-status-warning-text mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-status-warning-text text-sm font-semibold">Review warnings</p>
              <ul className="text-ink-600 mt-2 space-y-1 text-xs leading-5">
                {warnings.map((warning, index) => (
                  <li key={`${warning}-${index}`}>
                    • {warningLabel(warning)}
                    {warning === 'duplicate_licence_number' && duplicateLicence
                      ? ` — ${duplicateLicence.driverName} (${duplicateLicence.employeeNumber})`
                      : ''}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="text-ink-400 h-4 w-4" aria-hidden="true" /> Driver identity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
            <Detail label="Name" value={<span className="font-medium text-ink-950">{driver.name}</span>} />
            <Detail label="Employee number" value={<span className="font-medium text-ink-950">{driver.employeeNumber}</span>} />
            <Detail
              label="Staff status"
              value={<StatusBadge status={driver.employmentStatus === 'active' ? 'success' : 'error'} label={driver.employmentStatus} />}
            />
            <Detail
              label="Driver status"
              value={
                <StatusBadge
                  status={driver.driverStatus === 'authorised' ? 'success' : driver.driverStatus === 'suspended' ? 'pending' : 'error'}
                  label={driver.driverStatus.replace(/_/g, ' ')}
                />
              }
            />
            <Detail
              label="Availability"
              value={<StatusBadge status={driver.availabilityStatus === 'available' ? 'success' : 'pending'} label={driver.availabilityStatus.replace(/_/g, ' ')} />}
            />
            <Detail label="Department / Office" value={`${driver.departmentName ?? '—'} / ${driver.officeName ?? '—'}`} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Camera className="text-ink-400 h-4 w-4" aria-hidden="true" /> Submitted documents
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
            {[
              { url: files.frontUrl, label: 'Licence front' },
              { url: files.backUrl, label: 'Licence back' },
            ].map((item) =>
              item.url ? (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setZoomImage(item.url)}
                  className="focus-ring group relative min-h-44 overflow-hidden rounded-[10px] border border-border bg-muted/20 sm:min-h-52"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.url} alt={item.label} className="h-44 w-full object-contain p-2 transition-transform group-hover:scale-[1.01] motion-reduce:transition-none sm:h-52" />
                  <span className="bg-ink-950/75 absolute right-2 bottom-2 rounded-[6px] px-2 py-1 text-[10px] font-medium text-white">
                    {item.label.replace('Licence ', '')} · view larger
                  </span>
                </button>
              ) : (
                <div key={item.label} className="text-ink-400 flex min-h-44 flex-col items-center justify-center rounded-[10px] border border-dashed border-border bg-muted/20 sm:min-h-52">
                  <ImageIcon className="h-8 w-8" aria-hidden="true" />
                  <p className="mt-2 text-xs">No {item.label.toLowerCase()} image</p>
                </div>
              ),
            )}
          </div>
          {files.pdfUrl && (
            <Button variant="secondary" size="sm" asChild className="mt-3">
              <a href={files.pdfUrl} target="_blank" rel="noreferrer">
                <FileSearch className="h-4 w-4" /> Open source PDF
              </a>
            </Button>
          )}
        </CardContent>
      </Card>

      {currentVerified && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <ArrowLeftRight className="text-ink-400 h-4 w-4" aria-hidden="true" /> Current verified licence · v{currentVerified.version}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
              <Detail label="Licence number" value={<span className="font-medium text-ink-950">{currentVerified.licenceNumber}</span>} />
              <Detail label="Class" value={<span className="font-medium text-ink-950">{currentVerified.licenceClass}</span>} />
              <Detail label="Issue date" value={currentVerified.issueDate} />
              <Detail label="Expiry date" value={currentVerified.expiryDate} />
            </div>
            {(currentVerified.frontUrl || currentVerified.backUrl) && (
              <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
                {[
                  { url: currentVerified.frontUrl, label: 'Current verified front' },
                  { url: currentVerified.backUrl, label: 'Current verified back' },
                ].map((item) =>
                  item.url ? (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => setZoomImage(item.url)}
                      className="focus-ring group relative min-h-36 overflow-hidden rounded-[10px] border border-border bg-muted/20"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.url} alt={item.label} className="h-36 w-full object-contain p-2 transition-transform group-hover:scale-[1.01] motion-reduce:transition-none" />
                      <span className="bg-ink-950/75 absolute right-2 bottom-2 rounded-[6px] px-2 py-1 text-[10px] font-medium text-white">view larger</span>
                    </button>
                  ) : (
                    <div key={item.label} className="text-ink-400 flex min-h-36 items-center justify-center rounded-[10px] border border-dashed border-border bg-muted/20 text-xs">
                      No {item.label.toLowerCase()} image
                    </div>
                  ),
                )}
              </div>
            )}
            {currentVerified.pdfUrl && (
              <Button variant="secondary" size="sm" asChild>
                <a href={currentVerified.pdfUrl} target="_blank" rel="noreferrer">
                  <FileSearch className="h-4 w-4" /> Open current verified PDF
                </a>
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <FileSearch className="text-ink-400 h-4 w-4" aria-hidden="true" /> OCR extraction & confirmed values
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="border-border bg-muted/30 rounded-[8px] border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="info" size="sm">
                OCR source: {licence.ocrProvider || (licence.ocrConfidence ? 'tesseract.js' : 'manual')}
              </Badge>
              {ocrConfidencePercent !== null && (
                <Badge variant="default" size="sm">
                  Confidence: {ocrConfidencePercent}%
                </Badge>
              )}
            </div>
            <p className="text-ink-500 mt-2 text-xs leading-5">
              OCR output is provisional until reviewed. Compare the extracted evidence with the original images and the current verified licence before approving.
            </p>
          </div>

          {extractedOcrEntries.length > 0 && (
            <div>
              <p className="text-ink-500 mb-2 text-xs font-semibold">OCR-extracted evidence</p>
              <div className="grid gap-x-6 gap-y-3 rounded-[8px] border border-border bg-muted/15 p-3 sm:grid-cols-2 xl:grid-cols-3">
                {extractedOcrEntries.map(([field, value]) => (
                  <Detail
                    key={field}
                    label={field.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ')}
                    value={displayOcrValue(value)}
                  />
                ))}
              </div>
            </div>
          )}

          {licence.ocrText && (
            <div>
              <p className="text-ink-500 mb-2 text-xs font-semibold">Raw OCR evidence</p>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-[8px] border border-border bg-muted/20 p-3 font-mono text-[11px] leading-5 text-ink-700">
                {licence.ocrText}
              </pre>
            </div>
          )}

          {canReview ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label required>Licence number</Label>
                <Input value={confirmedValues.licenceNumber} onChange={(event) => setConfirmedValues((value) => ({ ...value, licenceNumber: event.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label required>Licence class</Label>
                <Input value={confirmedValues.licenceClass} onChange={(event) => setConfirmedValues((value) => ({ ...value, licenceClass: event.target.value }))} placeholder="B, C1" />
              </div>
              <div className="space-y-1.5">
                <Label required>Issue date</Label>
                <StyledDateInput type="date" value={confirmedValues.issueDate} onChange={(event) => setConfirmedValues((value) => ({ ...value, issueDate: event.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label required>Expiry date</Label>
                <StyledDateInput type="date" value={confirmedValues.expiryDate} onChange={(event) => setConfirmedValues((value) => ({ ...value, expiryDate: event.target.value }))} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Holder name</Label>
                <Input value={confirmedValues.holderName} onChange={(event) => setConfirmedValues((value) => ({ ...value, holderName: event.target.value }))} />
              </div>
            </div>
          ) : (
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-5">
              <Detail label="Licence number" value={<span className="font-medium text-ink-950">{confirmedValues.licenceNumber || '—'}</span>} />
              <Detail label="Licence class" value={<span className="font-medium text-ink-950">{confirmedValues.licenceClass || '—'}</span>} />
              <Detail label="Issue date" value={confirmedValues.issueDate || '—'} />
              <Detail label="Expiry date" value={confirmedValues.expiryDate || '—'} />
              <Detail label="Holder name" value={confirmedValues.holderName || '—'} />
            </div>
          )}

          {corrections.length > 0 && (
            <div className="border-border border-t pt-4">
              <p className="text-ink-500 text-xs font-semibold">Correction history</p>
              <div className="mt-2 space-y-2">
                {corrections.map((correction, index) => (
                  <div key={`${correction.fieldName}-${index}`} className="text-ink-600 flex flex-col gap-1 text-xs sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-2">
                    <span className="font-medium">{correction.fieldName.replace(/([a-z])([A-Z])/g, '$1 $2')}:</span>
                    <span className="line-through opacity-60">{correction.originalValue || '—'}</span>
                    <span aria-hidden="true">→</span>
                    <span className="text-ink-800 font-medium">{correction.correctedValue}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <History className="text-ink-400 h-4 w-4" aria-hidden="true" /> Version history
          </CardTitle>
        </CardHeader>
        <CardContent>
          {previousVersions.length === 0 ? (
            <p className="text-ink-500 text-xs">No other licence versions on record.</p>
          ) : (
            <div className="border-border overflow-hidden rounded-[8px] border">
              {previousVersions.map((version) => (
                <div key={version.id} className="border-border flex flex-col gap-2 border-b px-3 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:px-4">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge variant="default" size="sm">v{version.version}</Badge>
                    <p className="text-ink-700 min-w-0 text-xs sm:text-sm">Class {version.licenceClass} · expires {version.expiryDate}</p>
                  </div>
                  <StatusBadge
                    status={version.isActive ? 'success' : version.verificationStatus === 'superseded' ? 'default' : 'pending'}
                    label={version.isActive ? 'Active' : version.verificationStatus.replace(/_/g, ' ')}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {canReview && !isBlocked && (
        <Card>
          <CardHeader className="pb-3"><CardTitle>Review decision</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Reason / reviewer note</Label>
              <Textarea
                placeholder="Required for Request Changes and Reject; optional for approval."
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
              />
            </div>
            <div className="mobile-action-bar flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <Button
                variant="primary"
                size="sm"
                loading={busy === 'approve'}
                disabled={
                  !confirmedValues.licenceNumber ||
                  !confirmedValues.licenceClass ||
                  !confirmedValues.issueDate ||
                  !confirmedValues.expiryDate
                }
                onClick={() => setConfirmAction('approve')}
                className="w-full sm:w-auto"
              >
                <CheckCircle2 className="h-4 w-4" /> Approve renewal
              </Button>
              <Button
                variant="secondary"
                size="sm"
                loading={busy === 'request_upload'}
                disabled={!reason.trim()}
                onClick={() => void runAction('request_upload')}
                className="w-full sm:w-auto"
              >
                <RefreshCw className="h-4 w-4" /> Request changes
              </Button>
              <Button
                variant="destructive"
                size="sm"
                loading={busy === 'reject'}
                disabled={!reason.trim()}
                onClick={() => setConfirmAction('reject')}
                className="w-full sm:w-auto"
              >
                <XCircle className="h-4 w-4" /> Reject
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {canReview && (
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
      )}

      {zoomImage && (
        <div
          className="bg-ink-950/85 fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6"
          onClick={() => setZoomImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Zoomed licence image"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoomImage} alt="Zoomed licence" className="max-h-[calc(100dvh-5rem)] max-w-full rounded-[10px] object-contain shadow-2xl" />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              setZoomImage(null);
            }}
            className="absolute top-3 right-3 sm:top-4 sm:right-4"
          >
            Close
          </Button>
        </div>
      )}
    </div>
  );
}
