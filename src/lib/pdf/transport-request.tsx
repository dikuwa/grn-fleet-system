import React from 'react';
import { Document, Text } from '@react-pdf/renderer';
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
  DocumentRow,
  DocumentSection,
  DocumentTable,
  DocumentVerificationBlock,
  DocumentVerificationFooter,
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
  documentHash?: string;

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

  goodsAndEquipment?: Array<{
    description: string;
    quantity?: string;
    purpose?: string;
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
  const passengerCount = data.passengers?.length ?? 0;

  // Derive estimated costs from activities if available
  const totalRouteKm =
    data.routes?.reduce((sum, r) => sum + (r.estimatedKilometres ?? 0), 0) ??
    data.totalAuthorisedKilometres;
  const documentTimestamp = data.submittedAt || data.issuedAt;

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
          issueDate={documentTimestamp ? formatHumanDate(documentTimestamp, branding?.locale) : undefined}
        />

        {/* ════════════════════════════════════════
           ROW 1: Request Summary | Requester Details
           ════════════════════════════════════════ */}
        <DocumentRow>
          {/* Left: Request Summary */}
          <DocumentSection title="Request summary">
            <DocumentFieldGrid
              fields={[
                { label: 'Reference', value: data.reference || 'Not recorded' },
                { label: 'Scope', value: humanizeKey(data.scope || 'regional') },
                {
                  label: 'Department',
                  value: data.department || data.requester?.department || 'Not recorded',
                },
                { label: 'Purpose', value: data.purpose || 'Not recorded' },
                { label: 'Status', value: formatDocumentStatus(status) },
                { label: 'Revision', value: data.revision != null ? String(data.revision) : '1' },
                {
                  label: 'Estimated distance',
                  value:
                    totalRouteKm != null
                      ? `${totalRouteKm.toLocaleString('en-NA')} km`
                      : 'Not estimated',
                },
                {
                  label: 'Special authority',
                  value: formatHumanValue(
                    data.specialAuthorityRequired,
                    'specialAuthorityRequired',
                  ),
                },
              ]}
            />
          </DocumentSection>
          {/* Right: Requester Details */}
          <DocumentSection title="Requester details">
            <DocumentFieldGrid
              fields={[
                { label: 'Name', value: data.requester?.name || 'Not recorded' },
                {
                  label: 'Employee number',
                  value: data.requester?.employeeNumber || 'Not recorded',
                },
                { label: 'Designation', value: data.requester?.designation || 'Not recorded' },
                { label: 'Office', value: data.requester?.office || 'Not recorded' },
                { label: 'Phone', value: data.requester?.phone || 'Not recorded' },
                { label: 'Email', value: data.requester?.email || 'Not recorded' },
              ]}
            />
          </DocumentSection>
        </DocumentRow>

        {/* ════════════════════════════════════════
           ROW 2: Journey Details | Passenger Manifest
           ════════════════════════════════════════ */}
        <DocumentRow>
          {/* Left: Journey / Route Details */}
          <DocumentSection title="Journey details">
            {data.routes && data.routes.length > 0 ? (
              <DocumentTable
                columns={[
                  { key: 'origin', label: 'Departure' },
                  { key: 'destination', label: 'Destination' },
                  { key: 'km', label: 'Est. km' },
                  { key: 'duration', label: 'Duration' },
                ]}
                rows={data.routes.map((route) => ({
                  origin: route.origin || 'Not specified',
                  destination: route.destination || 'Not specified',
                  km:
                    route.estimatedKilometres != null
                      ? `${route.estimatedKilometres.toLocaleString('en-NA')} km`
                      : '—',
                  duration:
                    route.estimatedDurationMinutes != null
                      ? `${route.estimatedDurationMinutes} min`
                      : '—',
                }))}
                emptyLabel="No journey details recorded"
              />
            ) : (
              <Text style={{ color: '#4B5563', fontSize: 7 }}>No route details recorded</Text>
            )}
          </DocumentSection>
          {/* Right: Passenger Manifest — drivers/requester are documented in their own sections. */}
          <DocumentSection title={`Passengers (${passengerCount})`}>
            <DocumentTable
              columns={[
                { key: 'name', label: 'Name' },
                { key: 'id', label: 'Emp. no.' },
                { key: 'dept', label: 'Dept / org' },
                { key: 'type', label: 'Type' },
              ]}
              rows={(data.passengers || []).map((passenger) => ({
                name: passenger.name,
                id: passenger.employeeNumber || '—',
                dept: passenger.departmentOrOrganisation || '—',
                type: humanizeKey(passenger.travellerType),
              }))}
              emptyLabel="No passengers recorded"
            />
          </DocumentSection>
        </DocumentRow>

        {/* ════════════════════════════════════════
           ROW 3: Activities | Requested Drivers
           ════════════════════════════════════════ */}
        <DocumentRow>
          {/* Left: Activities */}
          <DocumentSection title="Activities and itinerary">
            {data.activities && data.activities.length > 0 ? (
              <DocumentTable
                columns={[
                  { key: 'activity', label: 'Activity' },
                  { key: 'location', label: 'Venue' },
                  { key: 'start', label: 'Start' },
                  { key: 'end', label: 'End' },
                  { key: 'km', label: 'Est. km' },
                ]}
                rows={data.activities.map((activity) => ({
                  activity: activity.title || 'Activity',
                  location: activity.venue || 'Not specified',
                  start: formatHumanDateTime(activity.startDate, branding?.locale),
                  end: formatHumanDateTime(activity.endDate, branding?.locale),
                  km:
                    activity.estimatedKilometres != null
                      ? `${activity.estimatedKilometres.toLocaleString('en-NA')} km`
                      : '—',
                }))}
                emptyLabel="No activities recorded"
              />
            ) : (
              <Text style={{ color: '#4B5563', fontSize: 7 }}>No activities recorded</Text>
            )}
          </DocumentSection>
          {/* Right: Requested Drivers */}
          <DocumentSection title="Requested drivers">
            {data.drivers && data.drivers.length > 0 ? (
              <DocumentTable
                columns={[
                  { key: 'name', label: 'Name' },
                  { key: 'dept', label: 'Department' },
                  { key: 'type', label: 'Type' },
                ]}
                rows={data.drivers.map((driver) => ({
                  name: driver.name,
                  dept: driver.department || '—',
                  type: humanizeKey(driver.driverType),
                }))}
                emptyLabel="No drivers requested"
              />
            ) : (
              <Text style={{ color: '#4B5563', fontSize: 7 }}>Not specified</Text>
            )}
          </DocumentSection>
        </DocumentRow>

        {/* ════════════════════════════════════════
           ROW 4: Goods & Equipment | Resources & Costs
           ════════════════════════════════════════ */}
        <DocumentRow>
          {/* Left: Goods & Equipment */}
          <DocumentSection title="Goods and equipment">
            <DocumentTable
              columns={[
                { key: 'description', label: 'Description', width: '42%' },
                { key: 'quantity', label: 'Quantity', width: '20%' },
                { key: 'purpose', label: 'Purpose', width: '38%' },
              ]}
              rows={(data.goodsAndEquipment || []).map((item) => ({
                description: item.description,
                quantity: item.quantity,
                purpose: item.purpose,
              }))}
              emptyLabel="No goods or equipment requested"
            />
          </DocumentSection>
          {/* Right: Estimated Resources */}
          <DocumentSection title="Estimated resources">
            <DocumentFieldGrid
              fields={[
                {
                  label: 'Total distance',
                  value:
                    totalRouteKm != null
                      ? `${totalRouteKm.toLocaleString('en-NA')} km`
                      : 'Not estimated',
                },
                { label: 'Estimated fuel', value: 'Not estimated' },
                { label: 'Accommodation', value: 'Not estimated' },
                { label: 'Meals', value: 'Not estimated' },
                { label: 'Other costs', value: 'Not estimated' },
                { label: 'Total estimate', value: 'Not estimated' },
                { label: 'Cost centre', value: 'Not recorded' },
              ]}
            />
          </DocumentSection>
        </DocumentRow>

        {/* ════════════════════════════════════════
           ROW 5: Approval Workflow
           ════════════════════════════════════════ */}
        {data.approvalWorkflow && data.approvalWorkflow.length > 0 && (
          <DocumentSection title="Approval workflow">
            <DocumentTable
              columns={[
                { key: 'stage', label: 'Stage' },
                { key: 'officer', label: 'Officer' },
                { key: 'decision', label: 'Decision' },
                { key: 'date', label: 'Date and time' },
                { key: 'comment', label: 'Comment' },
              ]}
              rows={data.approvalWorkflow.map((approval) => ({
                stage:
                  approval.stage != null
                    ? String(approval.stage)
                    : humanizeKey(approval.action || 'action'),
                officer: approval.officer || 'Not recorded',
                decision: approval.decision ? humanizeKey(approval.decision) : 'Pending',
                date: approval.dateTime
                  ? formatHumanDateTime(approval.dateTime, branding?.locale)
                  : '—',
                comment: approval.comment || '—',
              }))}
              emptyLabel="No approvals recorded"
            />
          </DocumentSection>
        )}

        {/* ════════════════════════════════════════
           ROW 6: Request Outcome
           ════════════════════════════════════════ */}
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

        {/* ── Verification block ── */}
        <DocumentVerificationBlock
          branding={branding}
          verificationCode={data.verificationCode}
          verificationUrl={data.verificationUrl}
          documentHash={data.documentHash}
          qrCode={data.qrCodeDataUrl}
        />

        <DocumentVerificationFooter
          branding={branding}
          verificationCode={data.verificationCode}
          verificationUrl={data.verificationUrl}
          documentHash={data.documentHash}
          generatedAt={documentTimestamp}
        />
      </DocumentPage>
    </Document>
  );
};
