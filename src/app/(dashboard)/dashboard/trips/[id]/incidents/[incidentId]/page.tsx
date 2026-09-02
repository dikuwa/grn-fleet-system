'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle,
  Download,
  FileText,
  RefreshCw,
  Loader2,
  Clock,
  MapPin,
  Car,
  CheckCircle2,
  Shield,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { InvestigationPanel } from '@/components/incidents/InvestigationPanel';
import { InsuranceTrackingPanel } from '@/components/incidents/InsuranceTrackingPanel';
import { TechnicalClearanceForm } from '@/components/incidents/TechnicalClearanceForm';
import type { InvestigationStatus, TechnicalClearanceStatus } from '@/lib/incidents/mva-constants';

interface Incident {
  id: string;
  officialNumber: string;
  incidentType: string;
  severity: string;
  status: string;
  occurredAt: string;
  location: string | null;
  description: string;
  injuries: boolean;
  numberInjured: number;
  vehicleDamage: boolean;
  vehicleSafe: boolean | null;
  passengerSafe: boolean | null;
  thirdPartyInvolvement: boolean;
  policeReference: string | null;
  emergencyServicesContacted: boolean;
  safeToContinue: boolean;
  continuationState: string;
  detailsRequired: boolean;
  attachmentKeys: string[] | null;
  investigationStatus: string;
  investigationNotes: string | null;
  investigationClosedAt: string | null;
  accidentReportNumber: string | null;
  witnessStatements: unknown[] | null;
  insuranceClaimReference: string | null;
  insuranceNotified: boolean;
  insuranceNotifiedAt: string | null;
  policeReportFiled: boolean;
  thirdPartyInsuranceDetails: Record<string, unknown> | null;
  technicalClearanceStatus: string;
  technicalClearanceAt: string | null;
  technicalClearanceByUserId: string | null;
}

interface IncidentCapabilities {
  canManage: boolean;
  canCompleteDetails: boolean;
  canInvestigate: boolean;
  canCloseInvestigation: boolean;
  canTechnicalClearance: boolean;
  canInsuranceUpdate: boolean;
  canGenerateMva: boolean;
  canViewFiles: boolean;
}

const EMPTY_CAPABILITIES: IncidentCapabilities = {
  canManage: false,
  canCompleteDetails: false,
  canInvestigate: false,
  canCloseInvestigation: false,
  canTechnicalClearance: false,
  canInsuranceUpdate: false,
  canGenerateMva: false,
  canViewFiles: false,
};

const SEVERITY_BADGE: Record<string, 'default' | 'info' | 'warning' | 'error'> = {
  minor: 'default',
  moderate: 'info',
  serious: 'warning',
  critical: 'error',
};

function formatSafety(value: boolean | null) {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return 'Not recorded';
}

function IncidentDetailInner() {
  const params = useParams();
  const tripId = params.id as string;
  const incidentId = params.incidentId as string;
  const { toast } = useToast();

  const [incident, setIncident] = useState<Incident | null>(null);
  const [capabilities, setCapabilities] = useState<IncidentCapabilities>(EMPTY_CAPABILITIES);
  const [loading, setLoading] = useState(true);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [downloadingReport, setDownloadingReport] = useState(false);
  const [completingDetails, setCompletingDetails] = useState(false);
  const [confirmCompleteOpen, setConfirmCompleteOpen] = useState(false);

  const fetchIncident = useCallback(async () => {
    setLoading(true);
    try {
      const [incidentRes, capabilityRes] = await Promise.all([
        fetch(`/api/incidents?tripId=${tripId}`),
        fetch('/api/incidents/capabilities'),
      ]);
      const json = await incidentRes.json();
      if (!incidentRes.ok) throw new Error(json.error);
      const found = json.data?.find((i: Incident) => i.id === incidentId);
      if (!found) throw new Error('Incident not found');
      setIncident(found);

      if (capabilityRes.ok) {
        const capabilityJson = await capabilityRes.json();
        setCapabilities({
          ...EMPTY_CAPABILITIES,
          ...(capabilityJson.capabilities || {}),
        });
      } else {
        setCapabilities(EMPTY_CAPABILITIES);
      }
    } catch (err) {
      setCapabilities(EMPTY_CAPABILITIES);
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to load incident',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [tripId, incidentId, toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchIncident();
  }, [fetchIncident]);

  const generateReport = useCallback(async () => {
    if (!capabilities.canGenerateMva) return;
    setGeneratingReport(true);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/mva-report`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Generation failed');
      toast({
        title: 'MVA report generated',
        description: `Version ${json.data.documentVersion} — status: ${json.data.status}`,
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Report generation failed',
        variant: 'error',
      });
    } finally {
      setGeneratingReport(false);
    }
  }, [capabilities.canGenerateMva, incidentId, toast]);

  const downloadReport = useCallback(async () => {
    if (!capabilities.canViewFiles) return;
    setDownloadingReport(true);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/mva-report`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Download failed');
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const headerFilename = disposition.match(/filename="?([^";]+)"?/i)?.[1];
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download =
        headerFilename ||
        `MVA Report - ${incident?.officialNumber || 'Incident'} - ${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Download failed',
        variant: 'error',
      });
    } finally {
      setDownloadingReport(false);
    }
  }, [capabilities.canViewFiles, incidentId, incident, toast]);

  const completeDetails = useCallback(async () => {
    if (!capabilities.canCompleteDetails) return;
    setCompletingDetails(true);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/complete`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to complete details');
      toast({ title: 'Incident details completed', variant: 'success' });
      fetchIncident();
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to complete details',
        variant: 'error',
      });
    } finally {
      setCompletingDetails(false);
    }
  }, [capabilities.canCompleteDetails, incidentId, toast, fetchIncident]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="text-brand-500 h-6 w-6 animate-spin" />
        <span className="text-ink-500 ml-2 text-sm">Loading incident...</span>
      </div>
    );
  }

  if (!incident) {
    return (
      <div className="text-ink-500 py-24 text-center">
        <AlertTriangle className="text-ink-300 mx-auto mb-3 h-12 w-12" />
        <p>Incident not found</p>
        <Button size="compact" variant="secondary" onClick={fetchIncident} className="mt-3">
          Try again
        </Button>
      </div>
    );
  }

  const severityBadge = SEVERITY_BADGE[incident.severity] || 'default';
  const hasMvaFields =
    incident.investigationStatus !== 'pending' ||
    incident.insuranceClaimReference ||
    incident.policeReportFiled ||
    incident.technicalClearanceStatus !== 'pending';
  const hasMvaReadOrActionAccess =
    capabilities.canManage ||
    capabilities.canInvestigate ||
    capabilities.canCloseInvestigation ||
    capabilities.canInsuranceUpdate ||
    capabilities.canTechnicalClearance;
  const showMvaWorkspace =
    hasMvaReadOrActionAccess &&
    (hasMvaFields ||
      incident.incidentType.includes('accident') ||
      incident.severity === 'critical' ||
      incident.severity === 'serious');
  const showInvestigationEvidence =
    capabilities.canManage || capabilities.canInvestigate || capabilities.canCloseInvestigation;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Trips', href: '/dashboard/trips' },
          { label: tripId.slice(0, 8), href: `/dashboard/trips/${tripId}` },
          { label: incident.officialNumber || 'Incident' },
        ]}
      />

      <PageHeader
        title={incident.officialNumber || 'Incident'}
        description={`Incident ${incident.id.slice(0, 8)} — reported ${new Date(incident.occurredAt).toLocaleDateString()}`}
      >
        <div className="flex gap-2">
          <Button size="compact" variant="secondary" onClick={fetchIncident} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          {capabilities.canGenerateMva && (
            <Button
              size="compact"
              variant="secondary"
              onClick={generateReport}
              disabled={generatingReport}
            >
              {generatingReport ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <FileText className="mr-1 h-4 w-4" />
              )}
              Generate MVAR
            </Button>
          )}
          {capabilities.canViewFiles && (
            <Button
              size="compact"
              variant="primary"
              onClick={downloadReport}
              disabled={downloadingReport}
            >
              {downloadingReport ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-1 h-4 w-4" />
              )}
              Download PDF
            </Button>
          )}
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="py-3">
            <p className="text-ink-500 text-xs">Severity</p>
            <Badge variant={severityBadge} size="sm" className="mt-1 capitalize">
              {incident.severity}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <p className="text-ink-500 text-xs">Type</p>
            <p className="mt-1 text-sm font-medium capitalize">
              {incident.incidentType.replace(/_/g, ' ')}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <p className="text-ink-500 text-xs">Occurrence</p>
            <div className="mt-1 flex items-center gap-1 text-sm">
              <Clock className="text-ink-400 h-3.5 w-3.5" />
              {new Date(incident.occurredAt).toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <p className="text-ink-500 text-xs">Location</p>
            <div className="mt-1 flex items-center gap-1 text-sm">
              <MapPin className="text-ink-400 h-3.5 w-3.5" />
              {incident.location || 'Not recorded'}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Safety & Impact</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div className="flex items-center gap-2">
              <Car className="text-ink-400 h-4 w-4" />
              <span className="text-ink-600">Vehicle safe:</span>
              <span className="font-medium">{formatSafety(incident.vehicleSafe)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-ink-600">Passengers safe:</span>
              <span className="font-medium">{formatSafety(incident.passengerSafe)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-ink-600">Injuries:</span>
              <span className="font-medium">
                {incident.injuries ? `${incident.numberInjured} reported` : 'None'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-ink-600">Third party:</span>
              <span className="font-medium">{incident.thirdPartyInvolvement ? 'Yes' : 'No'}</span>
            </div>
          </div>
          <p className="text-ink-500 mt-3 text-xs">
            Journey continuation: {incident.continuationState.replace(/_/g, ' ')}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Description</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-ink-700 text-sm whitespace-pre-wrap">{incident.description}</p>
          {incident.detailsRequired && (
            <>
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950/30 dark:text-yellow-200">
                <AlertTriangle className="h-4 w-4" />
                Additional details required before this incident can be finalised.
              </div>
              {capabilities.canCompleteDetails && (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="compact"
                    variant="primary"
                    onClick={() => setConfirmCompleteOpen(true)}
                    disabled={completingDetails}
                  >
                    {completingDetails ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-1 h-4 w-4" />
                    )}
                    Complete Details
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {incident.attachmentKeys && incident.attachmentKeys.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">
              Attachments ({incident.attachmentKeys.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {incident.attachmentKeys.map((key, i) => (
                <span
                  key={key}
                  className="bg-surface-hover text-ink-600 border-border inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs"
                >
                  <FileText className="h-3 w-3" />
                  Attachment {i + 1}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {showMvaWorkspace && (
        <div className="space-y-6">
          <h2 className="text-ink-900 flex items-center gap-2 text-lg font-semibold">
            <FileText className="h-5 w-5" />
            Motor Vehicle Accident Report
          </h2>

          {showInvestigationEvidence && (
            <InvestigationPanel
              incidentId={incidentId}
              tripId={tripId}
              data={{
                investigationStatus: incident.investigationStatus as InvestigationStatus,
                investigationNotes: incident.investigationNotes,
                investigationClosedAt: incident.investigationClosedAt,
                accidentReportNumber: incident.accidentReportNumber,
                witnessStatements: incident.witnessStatements as Array<Record<string, unknown>> | null,
              }}
              canInvestigate={capabilities.canInvestigate}
              canCloseInvestigation={capabilities.canCloseInvestigation}
              onUpdate={fetchIncident}
            />
          )}

          {capabilities.canInsuranceUpdate ? (
            <InsuranceTrackingPanel
              incidentId={incidentId}
              data={{
                insuranceClaimReference: incident.insuranceClaimReference,
                insuranceNotified: incident.insuranceNotified,
                insuranceNotifiedAt: incident.insuranceNotifiedAt,
                policeReportFiled: incident.policeReportFiled,
                thirdPartyInsuranceDetails: incident.thirdPartyInsuranceDetails,
              }}
              onUpdate={fetchIncident}
            />
          ) : capabilities.canManage ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <Shield className="h-4 w-4" />
                  Insurance & Police
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-ink-500 text-xs">Claim reference</p>
                  <p className="mt-1 font-medium">{incident.insuranceClaimReference || 'Not recorded'}</p>
                </div>
                <div>
                  <p className="text-ink-500 text-xs">Insurer notified</p>
                  <p className="mt-1 font-medium">{incident.insuranceNotified ? 'Yes' : 'No'}</p>
                </div>
                <div>
                  <p className="text-ink-500 text-xs">Police report filed</p>
                  <p className="mt-1 font-medium">{incident.policeReportFiled ? 'Yes' : 'No'}</p>
                </div>
                <div>
                  <p className="text-ink-500 text-xs">Notification date</p>
                  <p className="mt-1 font-medium">
                    {incident.insuranceNotifiedAt
                      ? new Date(incident.insuranceNotifiedAt).toLocaleDateString()
                      : 'Not recorded'}
                  </p>
                </div>
                {incident.thirdPartyInsuranceDetails ? (
                  <div className="sm:col-span-2">
                    <p className="text-ink-500 text-xs">Third-party insurance details</p>
                    <pre className="border-border bg-muted/30 mt-1 overflow-x-auto rounded-lg border p-3 text-xs">
                      {JSON.stringify(incident.thirdPartyInsuranceDetails, null, 2)}
                    </pre>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {capabilities.canTechnicalClearance ? (
            <TechnicalClearanceForm
              incidentId={incidentId}
              data={{
                technicalClearanceStatus: incident.technicalClearanceStatus as TechnicalClearanceStatus,
                technicalClearanceAt: incident.technicalClearanceAt,
                technicalClearanceByUserId: incident.technicalClearanceByUserId,
              }}
              onUpdate={fetchIncident}
            />
          ) : capabilities.canManage ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold">Technical Clearance</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Badge
                  variant={incident.technicalClearanceStatus === 'cleared' ? 'success' : 'warning'}
                  size="sm"
                  className="capitalize"
                >
                  {incident.technicalClearanceStatus.replace(/_/g, ' ')}
                </Badge>
                <p className="text-ink-500 text-xs">
                  {incident.technicalClearanceAt
                    ? `Decision recorded ${new Date(incident.technicalClearanceAt).toLocaleString()}`
                    : 'No technical-clearance decision has been recorded.'}
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      {capabilities.canCompleteDetails && (
        <ConfirmDialog
          open={confirmCompleteOpen}
          onOpenChange={setConfirmCompleteOpen}
          title="Complete incident details?"
          description="Marking the details as complete finalises the incident record. Missing or incomplete details will be locked from further editing."
          confirmLabel="Complete details"
          onConfirm={completeDetails}
        />
      )}
    </div>
  );
}

export default function IncidentDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24">
          <Loader2 className="text-brand-500 h-6 w-6 animate-spin" />
        </div>
      }
    >
      <IncidentDetailInner />
    </Suspense>
  );
}
