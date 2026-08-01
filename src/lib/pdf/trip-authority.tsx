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
  DocumentRow,
  DocumentSection,
  DocumentSignature,
  DocumentTable,
  DocumentVerificationBlock,
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
  // ── Journey details (route legs) ──
  journeyLegs?: Array<{
    origin: string;
    destination: string;
    departureDate: string;
    departureTime?: string;
    returnDate: string;
    returnTime?: string;
    estimatedKm?: number;
    objective?: string;
  }>;
  // ── Authorisation details ──
  authorisation?: {
    authoriserName: string;
    authoriserRole: string;
    authorisedAt?: string;
    transportOfficerName: string;
    transportOfficerRole?: string;
    issueDate: string;
    contactNumber?: string;
    approvalMethod?: string;
  };
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
  goodsAndEquipment?: Array<{
    description: string;
    quantity?: string;
    purpose?: string;
  }>;
  preDepartureInspection?: {
    status: string;
    odometer?: number;
    items?: Array<{ label: string; result: string; comment?: string }>;
    defects?: Array<{ severity: string; description: string }>;
    notes?: string;
    completedAt?: string;
    inspectorName?: string;
  };
  fuelInformation?: {
    fuelCardNumber?: string;
    expectedFuel?: string;
    fuelType?: string;
    costCentre?: string;
  };
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

  const journeyLegs = data.journeyLegs || [];

  return (
    <Document title={`Trip Authority ${data.reference}`}>
      <DocumentPage status={status === 'draft' ? 'draft' : undefined}>
        {/* ── Header ── */}
        <DocumentHeader
          branding={branding}
          title={'Official Vehicle Trip Authority\nAnd Log Statement'}
          reference={data.reference}
          version={data.documentVersion || 1}
          status={formatDocumentStatus(status)}
          issueDate={formatHumanDate(data.issuedAt || new Date().toISOString(), branding?.locale)}
          qrCode={data.qrCodeDataUrl}
        />

        {/* A and B intentionally share one compact bordered row. */}
        <DocumentRow>
          <DocumentSection title="A. Authority Summary">
            <DocumentFieldGrid
              fields={[
                { label: 'Scope', value: humanizeKey(data.scope) },
                { label: 'Purpose', value: data.purpose || 'Not recorded' },
                { label: 'Validity', value: [data.startAt, data.endAt].filter(Boolean).join(' — ') || 'Not set' },
                { label: 'Authority number', value: data.reference },
                { label: 'Request number', value: data.requestReference || 'Not linked' },
                { label: 'Department', value: data.department || 'Not recorded' },
                { label: 'Transport office', value: data.transportOffice || 'Not recorded' },
              ]}
            />
          </DocumentSection>
          <DocumentSection title="B. Vehicle Particulars">
            <DocumentFieldGrid
              fields={[
                { label: 'Registration', value: data.vehicle.licenceNumber },
                { label: 'Register number', value: data.vehicle.vehicleRegisterNumber },
                { label: 'Make and model', value: `${data.vehicle.make} ${data.vehicle.model}`.trim() },
                { label: 'Colour', value: data.vehicle.colour || 'Not recorded' },
                { label: 'Fuel type', value: data.vehicle.fuelType || 'Not recorded' },
                { label: 'Odometer out', value: formatHumanValue(data.beginningOdometer ?? data.vehicle.currentOdometer, 'odometer') },
                { label: 'Inspection', value: formatDocumentStatus(data.vehicle.inspectionStatus || 'pending') },
                { label: 'Cost centre', value: data.fuelInformation?.costCentre || 'Not recorded' },
              ]}
            />
          </DocumentSection>
        </DocumentRow>

        <DocumentSection title="C. Main Driver Details">
          <DocumentFieldGrid fields={[
            { label: 'Driver', value: data.driver?.name || 'Not assigned' },
            { label: 'Employee number', value: data.driver?.employeeNumber || 'Not recorded' },
            { label: 'Designation', value: data.driver?.designation || 'Not recorded' },
            { label: 'Department', value: data.driver?.department || 'Not recorded' },
            { label: 'Licence', value: [data.driver?.licenceNumber, data.driver?.licenceClass].filter(Boolean).join(' · ') || 'Not recorded' },
            { label: 'Licence expiry', value: data.driver?.licenceExpiry || 'Not recorded' },
            { label: 'Contact', value: data.driver?.contactNumber || 'Not recorded' },
            { label: 'Acknowledged', value: data.driver?.acceptedAt || 'Pending' },
          ]} />
          {(data.additionalDrivers?.length || 0) > 0 && <DocumentTable columns={[
            { key: 'name', label: 'Additional driver' }, { key: 'employeeNumber', label: 'Employee no.' },
            { key: 'licenceClass', label: 'Licence class' }, { key: 'licenceExpiry', label: 'Expiry' },
          ]} rows={(data.additionalDrivers || []).map((driver) => ({
            name: driver.name, employeeNumber: driver.employeeNumber || '—', licenceClass: driver.licenceClass || '—', licenceExpiry: driver.licenceExpiry || '—',
          }))} />}
        </DocumentSection>

        {/* ════════════════════════════════════════
           ROW 3: Journey Details | Authorised Passengers
           ════════════════════════════════════════ */}
        <DocumentRow>
          {/* Left: Journey Details */}
          <DocumentSection title="D. Journey Details">
            {journeyLegs.length > 0 ? (
              <>
                <DocumentTable
                  columns={[
                    { key: 'origin', label: 'From' },
                    { key: 'destination', label: 'To' },
                    { key: 'departure', label: 'Departure' },
                    { key: 'ret', label: 'Return' },
                    { key: 'km', label: 'Km' },
                  ]}
                  rows={journeyLegs.map((leg) => ({
                    origin: leg.origin || 'Not specified',
                    destination: leg.destination || 'Not specified',
                    departure: leg.departureDate || 'Not set',
                    ret: leg.returnDate || 'Not set',
                    km: leg.estimatedKm ? `${leg.estimatedKm.toLocaleString('en-NA')} km` : '—',
                  }))}
                  emptyLabel="No route legs recorded"
                />
                <Text style={{ marginTop: 3, fontSize: 6.5, color: '#374151' }}>
                  Total distance:{' '}
                  {data.totalKm ? `${data.totalKm.toLocaleString('en-NA')} km` : 'Not estimated'}
                </Text>
              </>
            ) : (
              <DocumentFieldGrid
                fields={[
                  { label: 'Approved route', value: data.routeSummary || 'Not recorded' },
                  {
                    label: 'Authorised distance',
                    value: data.totalKm
                      ? `${data.totalKm.toLocaleString('en-NA')} km`
                      : 'Not estimated',
                  },
                  { label: 'Objective', value: data.purpose || 'Not recorded' },
                ]}
              />
            )}
          </DocumentSection>
          {/* Right: Authorised Passengers */}
          <DocumentSection title={`E. Authorised Passengers (${data.passengers?.length || 0})`}>
            <DocumentTable
              columns={[
                { key: 'name', label: 'Name' },
                { key: 'employeeNumber', label: 'Employee no. / ID' },
                { key: 'organisation', label: 'Department / organisation' },
                { key: 'type', label: 'Type' },
              ]}
              rows={(data.passengers || []).map((passenger) => ({
                name: passenger.name,
                employeeNumber: passenger.employeeNumber || 'External',
                organisation: passenger.department || passenger.organisation || 'Not recorded',
                type: humanizeKey(passenger.passengerType || 'passenger'),
              }))}
              emptyLabel="No passengers authorised"
            />
          </DocumentSection>
        </DocumentRow>

        {/* ════════════════════════════════════════
           ROW 4: Goods & Equipment | Pre-departure Inspection
           ════════════════════════════════════════ */}
          <DocumentSection title="F. Goods / Equipment">
            {data.goodsAndEquipment && data.goodsAndEquipment.length > 0 ? (
              <DocumentTable
                columns={[
                  { key: 'description', label: 'Description' },
                  { key: 'quantity', label: 'Quantity' },
                  { key: 'purpose', label: 'Purpose' },
                ]}
                rows={data.goodsAndEquipment.map((item) => ({
                  description: item.description,
                  quantity: item.quantity || '—',
                  purpose: item.purpose || '—',
                }))}
                emptyLabel="No goods or equipment recorded"
              />
            ) : (
              <Text style={{ color: '#4B5563', fontSize: 7 }}>None recorded</Text>
            )}
          </DocumentSection>

          <DocumentSection title="G. Special Conditions" wrap={false}>
            {conditions.length > 0 ? (
              conditions.map((condition, index) => (
                <Text key={condition} style={{ marginBottom: 1.5, fontSize: 6.5 }}>
                  {index + 1}. {condition}
                </Text>
              ))
            ) : (
              <>
                <Text style={{ marginBottom: 1.5, fontSize: 6.5, color: '#4B5563' }}>
                  1. Authority is valid only for the approved purpose and period.
                </Text>
                <Text style={{ marginBottom: 1.5, fontSize: 6.5, color: '#4B5563' }}>
                  2. Driver must comply with traffic laws and council policies.
                </Text>
                <Text style={{ marginBottom: 1.5, fontSize: 6.5, color: '#4B5563' }}>
                  3. Accidents, breakdowns and incidents must be reported immediately.
                </Text>
                <Text style={{ marginBottom: 1.5, fontSize: 6.5, color: '#4B5563' }}>
                  4. This document must be produced when requested by an authorised officer.
                </Text>
              </>
            )}
          </DocumentSection>

        {/* ════════════════════════════════════════
           ROW 6: Approvals (three-column)
           ════════════════════════════════════════ */}
        <DocumentSection title="H. Approvals" wrap={false}>
          <View style={documentStyles.signatureRow}>
            {data.transportOfficer ? (
              <DocumentSignature
                name={data.transportOfficer.name}
                role={data.transportOfficer.designation || 'Transport Officer'}
                signedAt={data.transportOfficer.issuedAt}
                signatureUrl={data.transportOfficer.signatureUrl}
              />
            ) : (
              <DocumentSignature name="—" role="Transport Officer" />
            )}
            <DocumentSignature
              name={data.authoriser?.name || data.authorisation?.authoriserName || '—'}
              role={data.authoriser?.designation || data.authorisation?.authoriserRole || 'Authorising Officer'}
              signedAt={data.authoriser?.authorisedAt || data.authorisation?.authorisedAt}
              signatureUrl={data.authoriser?.signatureUrl}
            />
            {data.driver ? (
              <DocumentSignature
                name={data.driver.name}
                role="Driver acknowledgement"
                signedAt={data.driver.acceptedAt}
                signatureUrl={data.driver.signatureUrl}
              />
            ) : (
              <DocumentSignature name="—" role="Driver acknowledgement" />
            )}
          </View>
        </DocumentSection>

        <View style={documentStyles.spacer} />

        {/* ════════════════════════════════════════
           Verification block
           ════════════════════════════════════════ */}
        <DocumentVerificationBlock
          branding={branding}
          verificationCode={data.verificationCode}
          verificationUrl={data.verificationUrl}
          qrCode={data.qrCodeDataUrl}
        />

        <DocumentVerificationFooter
          branding={branding}
          verificationCode={data.verificationCode}
          verificationUrl={data.verificationUrl}
        />
      </DocumentPage>
    </Document>
  );
};
