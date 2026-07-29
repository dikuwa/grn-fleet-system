import React from 'react';
import { Document, Text, View } from '@react-pdf/renderer';
import type { ResolvedTenantBranding } from '@/lib/tenant-branding';
import {
  formatDocumentStatus,
  formatHumanDate,
  formatHumanValue,
  humanizeKey,
} from '@/lib/human-readable';
import {
  DocumentFieldGrid,
  DocumentHeader,
  DocumentPage,
  DocumentSection,
  DocumentSignature,
  DocumentTable,
  DocumentVerificationFooter,
  documentStyles,
} from './document-system';

export interface TripAuthorityData {
  reference: string;
  tenantName?: string;
  tenantDocumentFooter?: string;
  branding?: ResolvedTenantBranding | null;
  vehicle: {
    licenceNumber: string;
    vehicleRegisterNumber: string;
    make: string;
    model: string;
    colour?: string;
    fuelType?: string;
    currentOdometer?: number;
    inspectionStatus?: string;
  };
  requestReference: string;
  scope: string;
  startAt: string;
  endAt: string;
  allocatedByUserId?: string;
  requesterName?: string;
  department?: string;
  transportOffice?: string;
  priority?: string;
  purpose?: string;
  routeSummary?: string;
  totalKm?: number;
  authorityStatus?: string;
  documentVersion?: number;
  issuedAt?: string;
  verificationCode?: string;
  verificationUrl?: string;
  qrCodeDataUrl?: string;
  driver?: {
    name: string;
    employeeNumber?: string;
    designation?: string;
    department?: string;
    contactNumber?: string;
    licenceNumber?: string;
    licenceClass?: string;
    licenceExpiry?: string;
    acceptedAt?: string;
    signatureUrl?: string;
  };
  passengers?: Array<{
    name: string;
    employeeNumber?: string;
    department?: string;
    organisation?: string;
    passengerType?: string;
    destination?: string;
    indemnityConfirmed?: boolean;
  }>;
  additionalDrivers?: Array<{
    name: string;
    employeeNumber?: string;
    licenceClass?: string;
    licenceExpiry?: string;
  }>;
  specialConditions?: string;
  beginningOdometer?: number;
  endingOdometer?: number;
  authoriser?: {
    name?: string;
    designation?: string;
    authorisedAt?: string;
    signatureUrl?: string;
  };
  transportOfficer?: {
    name: string;
    designation?: string;
    issuedAt?: string;
    signatureUrl?: string;
  };
  routeEntries?: Array<{
    occurredAt: string;
    type: string;
    location?: string;
    odometer?: number;
    note?: string;
  }>;
  defects?: Array<{ severity: string; description: string; status?: string }>;
  incidents?: Array<{
    type: string;
    occurredAt: string;
    description: string;
    safeToContinue: boolean;
  }>;
  arrivalInspection?: { status: string; odometer?: number; completedAt?: string };
}

export const TripAuthorityDocument: React.FC<{ data: TripAuthorityData }> = ({ data }) => {
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
  const status = data.authorityStatus || 'issued';
  const conditions = (data.specialConditions || '')
    .split(/\n|;/)
    .map((condition) => condition.trim())
    .filter(Boolean);
  return (
    <Document title={`Trip Authority ${data.reference}`}>
      <DocumentPage status={status === 'draft' ? 'draft' : undefined}>
        <DocumentHeader
          branding={branding}
          title="Trip Authority"
          reference={data.reference}
          version={data.documentVersion || 1}
          status={formatDocumentStatus(status)}
          issueDate={formatHumanDate(data.issuedAt || new Date().toISOString(), branding?.locale)}
          qrCode={data.qrCodeDataUrl}
        />

        <DocumentSection title="Trip summary">
          <DocumentFieldGrid
            fields={[
              { label: 'Request reference', value: data.requestReference },
              { label: 'Purpose', value: data.purpose || 'Not recorded' },
              { label: 'Scope', value: humanizeKey(data.scope) },
              { label: 'Department', value: data.department || 'Not recorded' },
              { label: 'Transport office', value: data.transportOffice || 'Not recorded' },
              { label: 'Validity', value: `${data.startAt} — ${data.endAt}` },
              { label: 'Approved route', value: data.routeSummary || 'Not recorded' },
              {
                label: 'Authorised distance',
                value: data.totalKm
                  ? `${data.totalKm.toLocaleString('en-NA')} km`
                  : 'Not estimated',
              },
            ]}
          />
        </DocumentSection>

        <DocumentSection title="Vehicle details">
          <DocumentFieldGrid
            fields={[
              { label: 'Registration / plate', value: data.vehicle.licenceNumber },
              { label: 'Asset register number', value: data.vehicle.vehicleRegisterNumber },
              {
                label: 'Make and model',
                value: `${data.vehicle.make} ${data.vehicle.model}`.trim(),
              },
              { label: 'Colour', value: data.vehicle.colour || 'Not recorded' },
              { label: 'Fuel type', value: data.vehicle.fuelType || 'Not recorded' },
              {
                label: 'Current odometer',
                value: formatHumanValue(
                  data.vehicle.currentOdometer ?? data.beginningOdometer,
                  'odometer',
                ),
              },
              {
                label: 'Inspection status',
                value: formatDocumentStatus(data.vehicle.inspectionStatus || 'pending'),
              },
            ]}
          />
        </DocumentSection>

        <DocumentSection title="Driver details">
          <DocumentFieldGrid
            fields={[
              { label: 'Driver', value: data.driver?.name || 'Not assigned' },
              { label: 'Employee number', value: data.driver?.employeeNumber || 'Not recorded' },
              { label: 'Designation', value: data.driver?.designation || 'Not recorded' },
              { label: 'Department', value: data.driver?.department || 'Not recorded' },
              {
                label: 'Licence',
                value:
                  [data.driver?.licenceNumber, data.driver?.licenceClass]
                    .filter(Boolean)
                    .join(' · ') || 'Not recorded',
              },
              { label: 'Licence expiry', value: data.driver?.licenceExpiry || 'Not recorded' },
              {
                label: 'Driver acknowledgement',
                value: data.driver?.acceptedAt
                  ? `Acknowledged ${data.driver.acceptedAt}`
                  : 'Awaiting acknowledgement',
              },
            ]}
          />
        </DocumentSection>

        <DocumentSection title={`Authorised travellers (${data.passengers?.length || 0})`}>
          <DocumentTable
            columns={[
              { key: 'name', label: 'Name' },
              { key: 'employeeNumber', label: 'Employee number / ID' },
              { key: 'organisation', label: 'Department / organisation' },
              { key: 'type', label: 'Traveller type' },
            ]}
            rows={(data.passengers || []).map((passenger) => ({
              name: passenger.name,
              employeeNumber: passenger.employeeNumber || 'External',
              organisation: passenger.department || passenger.organisation || 'Not recorded',
              type: humanizeKey(passenger.passengerType || 'passenger'),
            }))}
            emptyLabel="No additional travellers authorised"
          />
        </DocumentSection>

        {conditions.length > 0 && (
          <DocumentSection title="Conditions" wrap={false}>
            {conditions.map((condition, index) => (
              <Text key={condition} style={{ marginBottom: 2 }}>
                {index + 1}. {condition}
              </Text>
            ))}
          </DocumentSection>
        )}

        <DocumentSection title="Approvals" wrap={false}>
          <View style={documentStyles.signatureRow}>
            {data.transportOfficer && (
              <DocumentSignature
                name={data.transportOfficer.name}
                role={data.transportOfficer.designation || 'Transport Officer'}
                signedAt={data.transportOfficer.issuedAt}
                signatureUrl={data.transportOfficer.signatureUrl}
              />
            )}
            <DocumentSignature
              name={data.authoriser?.name || 'Authorising officer not recorded'}
              role={data.authoriser?.designation || 'Authorising Officer'}
              signedAt={data.authoriser?.authorisedAt}
              signatureUrl={data.authoriser?.signatureUrl}
            />
            {data.driver && (
              <DocumentSignature
                name={data.driver.name}
                role="Driver acknowledgement"
                signedAt={data.driver.acceptedAt}
                signatureUrl={data.driver.signatureUrl}
              />
            )}
          </View>
        </DocumentSection>

        {(data.routeEntries?.length || data.defects?.length || data.incidents?.length) && (
          <DocumentSection title="Operational record">
            <DocumentTable
              columns={[
                { key: 'event', label: 'Event' },
                { key: 'details', label: 'Details' },
                { key: 'time', label: 'Date and time' },
              ]}
              rows={[
                ...(data.routeEntries || []).map((entry) => ({
                  event: humanizeKey(entry.type),
                  details: [entry.location, entry.note].filter(Boolean).join(' · '),
                  time: entry.occurredAt,
                })),
                ...(data.defects || []).map((defect) => ({
                  event: `Defect · ${humanizeKey(defect.severity)}`,
                  details: defect.description,
                  time: humanizeKey(defect.status || 'open'),
                })),
                ...(data.incidents || []).map((incident) => ({
                  event: humanizeKey(incident.type),
                  details: incident.description,
                  time: incident.occurredAt,
                })),
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
