import React from 'react';
import { Document, Text, View } from '@react-pdf/renderer';
import type { ResolvedTenantBranding } from '@/lib/tenant-branding';
import {
  formatDocumentStatus,
  formatHumanDate,
  formatHumanDateTime,
  formatHumanValue,
  humanizeKey,
} from '@/lib/human-readable';
import {
  DocumentFieldGrid,
  DocumentHeader,
  DocumentPage,
  DocumentSection,
  DocumentTable,
  DocumentVerificationFooter,
  documentStyles,
} from './document-system';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransportRequestData {
  reference: string;
  revision?: number;
  scope: string;
  status: string;
  department?: string;
  purpose?: string;
  submittedAt?: string;
  totalAuthorisedKilometres?: number;
  specialAuthorityRequired?: boolean;

  tenantName?: string;
  tenantDocumentFooter?: string;
  branding?: ResolvedTenantBranding | null;
  documentVersion?: number;
  issuedAt?: string;
  verificationCode?: string;
  verificationUrl?: string;
  qrCodeDataUrl?: string;

  requester: {
    name: string;
    employeeNumber?: string;
    designation?: string;
    department?: string;
    office?: string;
    phone?: string;
    email?: string;
  };

  activities?: Array<{
    title: string;
    description?: string;
    venue?: string;
    startDate: string;
    endDate: string;
    estimatedKilometres?: number;
  }>;

  passengers?: Array<{
    name: string;
    employeeNumber?: string;
    departmentOrOrganisation?: string;
    role?: string;
    travellerType: string;
    reasonForTravel?: string;
  }>;

  travellerCount?: number;

  drivers?: Array<{
    driverType: string;
    sortOrder?: number;
    name: string;
    employeeNumber?: string;
    department?: string;
  }>;

  routes?: Array<{
    origin?: string;
    destination?: string;
    estimatedKilometres?: number;
    estimatedDurationMinutes?: number;
  }>;

  attachments?: Array<{
    fileName?: string;
    mimeType?: string;
  }>;

  approvalWorkflow?: Array<{
    stage?: number;
    action?: string;
    officer: string;
    decision?: string;
    dateTime?: string;
    comment?: string;
    signature?: string;
  }>;

  // Post-approvals outcome fields (can be enriched by caller)
  outcome?: {
    finalStatus?: string;
    linkedAuthorityReference?: string;
    allocatedVehicle?: string;
    allocatedDriver?: string;
    allocationDate?: string;
    approvalDate?: string;
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TransportRequestDocument: React.FC<{
  data: TransportRequestData;
}> = ({ data }) => {
  const branding =
    data.branding ||
    (data.tenantName
      ? {
          tenantId: '',
          organisationName: data.tenantName,
          code: '',
          locale: 'en-NA',
          timezone: 'Africa/Windhoek',
          primaryColor: '#1F2A44',
          accentColor: '#0F766E',
          documentFooter: data.tenantDocumentFooter,
        }
      : null);

  const status = data.status || 'draft';

  // Compute total traveller count
  const travellerCount =
    data.travellerCount ?? (data.passengers ? data.passengers.length + 1 : 1);

  // Derive estimated costs from activities if available
  const totalRouteKm =
    data.routes?.reduce((sum, r) => sum + (r.estimatedKilometres ?? 0), 0) ??
    data.totalAuthorisedKilometres;

  return (
    <Document title={`Transport Request ${data.reference}`}>
      <DocumentPage status={status === 'draft' ? 'draft' : undefined}>
        {/* ── Header ── */}
        <DocumentHeader
          branding={branding}
          title="Transport Request"
          reference={data.reference}
          version={data.documentVersion || 1}
          status={formatDocumentStatus(status)}
          issueDate={formatHumanDate(
            data.submittedAt || data.issuedAt || new Date().toISOString(),
            branding?.locale,
          )}
          qrCode={data.qrCodeDataUrl}
        />

        {/* ── Request summary ── */}
        <DocumentSection title="Request summary">
          <DocumentFieldGrid
            fields={[
              { label: 'Request reference', value: data.reference || 'Not recorded' },
              {
                label: 'Requester',
                value: data.requester?.name || 'Not recorded',
              },
              {
                label: 'Employee number',
                value: data.requester?.employeeNumber || 'Not recorded',
              },
              {
                label: 'Department',
                value: data.department || data.requester?.department || 'Not recorded',
              },
              {
                label: 'Office',
                value: data.requester?.office || 'Not recorded',
              },
              {
                label: 'Designation',
                value: data.requester?.designation || 'Not recorded',
              },
              {
                label: 'Scope',
                value: humanizeKey(data.scope || 'regional'),
              },
              {
                label: 'Priority',
                value: 'Normal', // default — could be enriched
              },
              {
                label: 'Estimated distance',
                value:
                  totalRouteKm != null
                    ? `${totalRouteKm.toLocaleString('en-NA')} km`
                    : 'Not estimated',
              },
              {
                label: 'Special authority required',
                value: formatHumanValue(data.specialAuthorityRequired, 'specialAuthorityRequired'),
              },
              {
                label: 'Purpose',
                value: data.purpose || 'Not recorded',
              },
            ]}
          />
        </DocumentSection>

        {/* ── Journey details ── */}
        {data.routes && data.routes.length > 0 && (
          <DocumentSection title="Journey details">
            <DocumentTable
              columns={[
                { key: 'origin', label: 'Departure' },
                { key: 'destination', label: 'Destination' },
                { key: 'km', label: 'Estimated km' },
                { key: 'duration', label: 'Estimated duration' },
              ]}
              rows={data.routes.map((route) => ({
                origin: route.origin || 'Not specified',
                destination: route.destination || 'Not specified',
                km:
                  route.estimatedKilometres != null
                    ? `${route.estimatedKilometres.toLocaleString('en-NA')} km`
                    : 'Not estimated',
                duration:
                  route.estimatedDurationMinutes != null
                    ? `${route.estimatedDurationMinutes} min`
                    : 'Not estimated',
              }))}
              emptyLabel="No journey details recorded"
            />
          </DocumentSection>
        )}

        {/* ── Selected employees and travellers ── */}
        <DocumentSection title={`Selected employees and travellers (${travellerCount})`}>
          <DocumentTable
            columns={[
              { key: 'name', label: 'Name' },
              { key: 'employeeNumber', label: 'Employee number' },
              { key: 'departmentOrOrganisation', label: 'Department / organisation' },
              { key: 'role', label: 'Role' },
              { key: 'travellerType', label: 'Traveller type' },
            ]}
            rows={[
              // Requester as first traveller
              {
                name: data.requester?.name || 'Requester',
                employeeNumber: data.requester?.employeeNumber || '—',
                departmentOrOrganisation: data.requester?.department || '—',
                role: 'Requester',
                travellerType: 'Requester',
              },
              // Drivers
              ...(data.drivers || []).map((driver) => ({
                name: driver.name,
                employeeNumber: driver.employeeNumber || '—',
                departmentOrOrganisation: driver.department || '—',
                role: `Driver (${humanizeKey(driver.driverType)})`,
                travellerType: 'Driver',
              })),
              // Passengers
              ...(data.passengers || []).map((p) => ({
                name: p.name,
                employeeNumber: p.employeeNumber || '—',
                departmentOrOrganisation: p.departmentOrOrganisation || '—',
                role: p.role || 'Passenger',
                travellerType: humanizeKey(p.travellerType),
              })),
            ]}
            emptyLabel="No travellers recorded"
          />
        </DocumentSection>

        {/* ── Requested transport and logistics ── */}
        <DocumentSection title="Requested transport and logistics">
          <DocumentFieldGrid
            fields={[
              {
                label: 'Vehicle required',
                value: data.routes && data.routes.length > 0 ? 'Yes' : 'Not specified',
              },
              {
                label: 'Number of vehicles',
                value: (data.drivers || []).length > 0 ? '1' : 'Not specified',
              },
              {
                label: 'Driver required',
                value: (data.drivers || []).length > 0 ? 'Yes' : 'Not specified',
              },
              {
                label: 'Requested driver(s)',
                value:
                  (data.drivers || []).length > 0
                    ? (data.drivers || []).map((d) => d.name).join(', ')
                    : 'Not specified',
              },
            ]}
          />
        </DocumentSection>

        {/* ── Activities / itinerary ── */}
        {data.activities && data.activities.length > 0 && (
          <DocumentSection title="Activities and itinerary">
            <DocumentTable
              columns={[
                { key: 'activity', label: 'Activity' },
                { key: 'location', label: 'Location / venue' },
                { key: 'start', label: 'Start' },
                { key: 'end', label: 'End' },
                { key: 'km', label: 'Estimated km' },
              ]}
              rows={data.activities.map((activity) => ({
                activity: activity.title || 'Activity',
                location: activity.venue || 'Not specified',
                start: formatHumanDateTime(activity.startDate, branding?.locale),
                end: formatHumanDateTime(activity.endDate, branding?.locale),
                km:
                  activity.estimatedKilometres != null
                    ? `${activity.estimatedKilometres.toLocaleString('en-NA')} km`
                    : 'Not estimated',
              }))}
              emptyLabel="No activities recorded"
            />
          </DocumentSection>
        )}

        {/* ── Estimated resources and costs ── */}
        <DocumentSection title="Estimated resources and costs">
          <DocumentFieldGrid
            fields={[
              {
                label: 'Total estimated distance',
                value:
                  totalRouteKm != null
                    ? `${totalRouteKm.toLocaleString('en-NA')} km`
                    : 'Not estimated',
              },
              {
                label: 'Estimated fuel',
                value: 'Not estimated',
              },
              {
                label: 'Accommodation',
                value: 'Not estimated',
              },
              {
                label: 'Meals',
                value: 'Not estimated',
              },
              {
                label: 'Other costs',
                value: 'Not estimated',
              },
              {
                label: 'Total estimated cost',
                value: 'Not estimated',
              },
              {
                label: 'Cost centre',
                value: 'Not recorded',
              },
              {
                label: 'Responsibility code',
                value: 'Not recorded',
              },
              {
                label: 'Objective code',
                value: 'Not recorded',
              },
            ]}
          />
        </DocumentSection>

        {/* ── Additional information ── */}
        <DocumentSection title="Additional information">
          <DocumentFieldGrid
            fields={[
              {
                label: 'Remarks',
                value: data.purpose || 'Not recorded',
              },
              {
                label: 'Attachments',
                value:
                  data.attachments && data.attachments.length > 0
                    ? `${data.attachments.length} file(s)`
                    : 'No attachments',
              },
            ]}
          />
        </DocumentSection>

        {/* ── Approval workflow ── */}
        {data.approvalWorkflow && data.approvalWorkflow.length > 0 && (
          <DocumentSection title="Approval workflow" wrap={false}>
            <DocumentTable
              columns={[
                { key: 'stage', label: 'Stage' },
                { key: 'officer', label: 'Officer' },
                { key: 'decision', label: 'Decision' },
                { key: 'date', label: 'Date and time' },
                { key: 'comment', label: 'Comment' },
              ]}
              rows={data.approvalWorkflow.map((approval) => ({
                stage: approval.stage != null ? String(approval.stage) : humanizeKey(approval.action || 'action'),
                officer: approval.officer || 'Not recorded',
                decision: approval.decision
                  ? humanizeKey(approval.decision)
                  : 'Pending',
                date: approval.dateTime
                  ? formatHumanDateTime(approval.dateTime, branding?.locale)
                  : '—',
                comment: approval.comment || '—',
              }))}
              emptyLabel="No approvals recorded"
            />
          </DocumentSection>
        )}

        {/* ── Request outcome ── */}
        {data.outcome && (
          <DocumentSection title="Request outcome" wrap={false}>
            <DocumentFieldGrid
              fields={[
                {
                  label: 'Final status',
                  value: formatDocumentStatus(data.outcome.finalStatus || status),
                },
                {
                  label: 'Linked trip authority',
                  value: data.outcome.linkedAuthorityReference || 'Not issued',
                },
                {
                  label: 'Allocated vehicle',
                  value: data.outcome.allocatedVehicle || 'Not allocated',
                },
                {
                  label: 'Allocated driver',
                  value: data.outcome.allocatedDriver || 'Not allocated',
                },
                {
                  label: 'Allocation date',
                  value: data.outcome.allocationDate
                    ? formatHumanDate(data.outcome.allocationDate, branding?.locale)
                    : 'Not recorded',
                },
                {
                  label: 'Approval date',
                  value: data.outcome.approvalDate
                    ? formatHumanDate(data.outcome.approvalDate, branding?.locale)
                    : 'Not recorded',
                },
              ]}
            />
          </DocumentSection>
        )}

        <DocumentVerificationFooter
          branding={branding}
          verificationCode={data.verificationCode}
          verificationUrl={data.verificationUrl}
        />
      </DocumentPage>
    </Document>
  );
};
