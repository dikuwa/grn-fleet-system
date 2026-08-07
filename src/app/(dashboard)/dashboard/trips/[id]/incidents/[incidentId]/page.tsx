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
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import { InvestigationPanel } from '@/components/incidents/InvestigationPanel';
import { InsuranceTrackingPanel } from '@/components/incidents/InsuranceTrackingPanel';
import { TechnicalClearanceForm } from '@/components/incidents/TechnicalClearanceForm';
import type { InvestigationStatus, TechnicalClearanceStatus } from '@/lib/incidents/mva-constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  thirdPartyInvolvement: boolean;
  policeReference: string | null;
  emergencyServicesContacted: boolean;
  safeToContinue: boolean;
  continuationState: string;
  detailsRequired: boolean;
  attachmentKeys: string[] | null;
  // MVA
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

const SEVERITY_BADGE: Record<string, 'default' | 'info' | 'warning' | 'error'> = {
  minor: 'default',
  moderate: 'info',
  serious: 'warning',
  critical: 'error',
};

// ---------------------------------------------------------------------------
// Inner page (suspended)
// ---------------------------------------------------------------------------

function IncidentDetailInner() {
  const params = useParams();
  const tripId = params.id as string;
  const incidentId = params.incidentId as string;
  const { toast } = useToast();

  const [incident, setIncident] = useState<Incident | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [downloadingReport, setDownloadingReport] = useState(false);
  const [completingDetails, setCompletingDetails] = useState(false);

  const fetchIncident = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/incidents?tripId=${tripId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      const found = json.data?.find((i: Incident) => i.id === incidentId);
      if (!found) throw new Error('Incident not found');
      setIncident(found);
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to load incident',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [tripId, incidentId, toast]);

  useEffect(() => { fetchIncident(); }, [fetchIncident]);

  const generateReport = useCallback(async () => {
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
  }, [incidentId, toast]);

  const downloadReport = useCallback(async () => {
    setDownloadingReport(true);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/mva-report`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Download failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `MVA-Report-${incident?.officialNumber || incidentId.slice(0, 8)}.pdf`;
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
  }, [incidentId, incident, toast]);

  const completeDetails = useCallback(async () => {
    if (!window.confirm('Mark this incident\'s details as complete?')) return;
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
  }, [incidentId, toast, fetchIncident]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
        <span className="ml-2 text-sm text-ink-500">Loading incident...</span>
      </div>
    );
  }

  if (!incident) {
    return (
      <div className="text-center py-24 text-ink-500">
        <AlertTriangle className="h-12 w-12 mx-auto mb-3 text-ink-300" />
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
            <Button
              size="compact"
              variant="secondary"
              onClick={fetchIncident}
              title="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              size="compact"
              variant="secondary"
              onClick={generateReport}
              disabled={generatingReport}
            >
              {generatingReport
                ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
                : <FileText className="h-4 w-4 mr-1" />
              }
              Generate MVAR
            </Button>
            <Button
              size="compact"
              variant="primary"
              onClick={downloadReport}
              disabled={downloadingReport}
            >
              {downloadingReport
                ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
                : <Download className="h-4 w-4 mr-1" />
              }
              Download PDF
            </Button>
        </div>
      </PageHeader>

      {/* Overview cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-ink-500">Severity</p>
            <Badge variant={severityBadge} size="sm" className="mt-1 capitalize">
              {incident.severity}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-ink-500">Type</p>
            <p className="text-sm font-medium mt-1 capitalize">{incident.incidentType.replace(/_/g, ' ')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-ink-500">Occurrence</p>
            <div className="flex items-center gap-1 text-sm mt-1">
              <Clock className="h-3.5 w-3.5 text-ink-400" />
              {new Date(incident.occurredAt).toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-ink-500">Location</p>
            <div className="flex items-center gap-1 text-sm mt-1">
              <MapPin className="h-3.5 w-3.5 text-ink-400" />
              {incident.location || 'Not recorded'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Safety flags */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Safety & Impact</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className="flex items-center gap-2">
              <Car className="h-4 w-4 text-ink-400" />
              <span className="text-ink-600">Vehicle safe:</span>
              <span className="font-medium">{incident.safeToContinue ? 'Yes' : 'No'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-ink-600">Passengers safe:</span>
              <span className="font-medium">{!incident.injuries ? 'Yes' : 'No'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-ink-600">Injuries:</span>
              <span className="font-medium">{incident.injuries ? `${incident.numberInjured} reported` : 'None'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-ink-600">Third party:</span>
              <span className="font-medium">{incident.thirdPartyInvolvement ? 'Yes' : 'No'}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Description */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Description</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-ink-700 whitespace-pre-wrap">{incident.description}</p>
          {incident.detailsRequired && (
            <>
              <div className="mt-3 rounded-lg bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 p-3 text-sm text-yellow-800 dark:text-yellow-200 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Additional details required before this incident can be finalised.
              </div>
              <div className="mt-3 flex justify-end">
                <Button
                  size="compact"
                  variant="primary"
                  onClick={completeDetails}
                  disabled={completingDetails}
                >
                  {completingDetails ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                  )}
                  Complete Details
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Attachments */}
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
                  className="inline-flex items-center gap-1 rounded-lg bg-surface-hover px-3 py-1.5 text-xs text-ink-600 border border-border"
                >
                  <FileText className="h-3 w-3" />
                  Attachment {i + 1}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* MVA Workflow panels — only show for accidents or when data already exists */}
      {(hasMvaFields || incident.incidentType.includes('accident') || incident.severity === 'critical' || incident.severity === 'serious') && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-ink-900 flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Motor Vehicle Accident Report
          </h2>

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
            onUpdate={fetchIncident}
          />

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

          <TechnicalClearanceForm
            incidentId={incidentId}
            data={{
              technicalClearanceStatus: incident.technicalClearanceStatus as TechnicalClearanceStatus,
              technicalClearanceAt: incident.technicalClearanceAt,
              technicalClearanceByUserId: incident.technicalClearanceByUserId,
            }}
            onUpdate={fetchIncident}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exported wrapper with Suspense
// ---------------------------------------------------------------------------

export default function IncidentDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
        </div>
      }
    >
      <IncidentDetailInner />
    </Suspense>
  );
}