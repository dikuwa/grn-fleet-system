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
  DocumentWarnings,
  SafePdfText,
  documentStyles,
  officialRedTheme,
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
    modelYear?: number | string;
    colour?: string;
    fuelType?: string;
    currentOdometer?: number;
    inspectionStatus?: string;
    inspectionDate?: string;
  };
  requestReference: string;
  requesterName?: string;
  department?: string;
  transportOffice?: string;
  priority?: string;
  scope: string;
  startAt: string;
  endAt: string;
  purpose?: string;
  routeSummary?: string;
  totalKm?: number;
  authorityStatus?: string;
  documentVersion?: number;
  issuedAt?: string;
  verificationCode?: string;
  verificationUrl?: string;
  documentHash?: string;
  qrCodeDataUrl?: string;
  driver?: {
    name: string;
    employeeNumber?: string;
    idNumber?: string;
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
    idNumber?: string;
    department?: string;
    organisation?: string;
    contactNumber?: string;
    passengerType?: string;
    destination?: string;
    indemnityConfirmed?: boolean;
  }>;
  additionalDrivers?: Array<{
    name: string;
    employeeNumber?: string;
    idNumber?: string;
    department?: string;
    contactNumber?: string;
    licenceNumber?: string;
    licenceClass?: string;
    licenceExpiry?: string;
  }>;
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
  specialConditions?: string;
  beginningOdometer?: number;
  endingOdometer?: number;
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
  goodsAndEquipment?: Array<{ description: string; quantity?: string; purpose?: string }>;
  preDepartureInspection?: Record<string, unknown>;
  fuelInformation?: Record<string, unknown>;
}

const STANDARD_CONDITIONS = [
  'Authority is valid only for the approved purpose and period.',
  'The driver must comply with traffic laws and the institution’s fleet policies.',
  'Accidents, breakdowns and incidents must be reported immediately.',
  'This document must be produced when requested by an authorised officer.',
];

/**
 * Official warning language retained from the approved physical Trip Authority
 * reference. Rendered in red, compact, near the document footer.
 */
const OFFICIAL_WARNINGS = [
  'Any unauthorised or unnecessary distance will be surcharged',
  'This authority must be returned with the vehicle log statement on completion of the trip',
];

function dateTime(date?: string, time?: string, locale = 'en-NA') {
  const displayDate = formatHumanDate(date, locale);
  return [displayDate, time].filter(Boolean).join(' ');
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
  const locale = branding?.locale || 'en-NA';
  const specialAuthority = (data.specialConditions || '')
    .split(/\n|;/)
    .map((item) => item.trim())
    .filter(Boolean);
  const legs = data.journeyLegs || [];
  const passengers = data.passengers || [];

  return (
    <Document
      title={`Official Vehicle Trip Authority ${data.reference}`}
      author={branding?.organisationName || 'Government Fleet'}
    >
      <DocumentPage
        status={data.authorityStatus === 'draft' ? 'draft' : undefined}
        official
        continuationLabel={`${branding?.organisationName || 'Government Fleet'} · Official Vehicle Trip Authority and Log Statement`}
      >
        <DocumentHeader
          branding={branding}
          title={'Official Vehicle Trip Authority\nAnd Log Statement'}
          official
          showIdentity={false}
        />

        <DocumentRow>
          <DocumentSection title="A. Authority Summary" theme={officialRedTheme}>
            <DocumentFieldGrid
              columns={1}
              labelWidth={36}
              fields={[
                { label: 'Scope', value: humanizeKey(data.scope) },
                { label: 'Purpose', value: data.purpose },
                {
                  label: 'Validity',
                  value: `${formatHumanDate(data.startAt, locale)} – ${formatHumanDate(data.endAt, locale)}`,
                },
                { label: 'Trip authority no.', value: data.reference },
              ]}
            />
          </DocumentSection>
          <DocumentSection title="B. Vehicle Particulars" theme={officialRedTheme}>
            <DocumentFieldGrid
              labelWidth={48}
              fields={[
                { label: 'Registration no./plate', value: data.vehicle.licenceNumber },
                { label: 'Fuel type', value: humanizeKey(data.vehicle.fuelType ?? '') },
                { label: 'Make', value: data.vehicle.make },
                {
                  label: 'Odometer (at start)',
                  value: formatHumanValue(
                    data.beginningOdometer ?? data.vehicle.currentOdometer,
                    'odometer',
                  ),
                },
                {
                  label: 'Model year/type',
                  value: [data.vehicle.modelYear, data.vehicle.model].filter(Boolean).join(' · '),
                },
                {
                  label: 'Inspection status',
                  value: [
                    formatDocumentStatus(data.vehicle.inspectionStatus || 'pending'),
                    data.vehicle.inspectionDate
                      ? `(${formatHumanDate(data.vehicle.inspectionDate, locale)})`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' '),
                },
                { label: 'Colour', value: data.vehicle.colour },
                { label: 'Register no.', value: data.vehicle.vehicleRegisterNumber },
              ]}
            />
          </DocumentSection>
        </DocumentRow>

        <DocumentSection title="C. Main Driver Details" theme={officialRedTheme}>
          <DocumentTable
            theme={officialRedTheme}
            columns={[
              { key: 'name', label: 'Driver name', width: '20%' },
              { key: 'employee', label: 'Employee no.', width: '14%' },
              { key: 'licence', label: 'Licence no.', width: '18%' },
              { key: 'department', label: 'Department', width: '16%' },
              { key: 'contact', label: 'Contact no.', width: '15%' },
              { key: 'id', label: 'ID number', width: '17%' },
            ]}
            rows={
              data.driver
                ? [
                    {
                      name: data.driver.name,
                      employee: data.driver.employeeNumber,
                      licence: [data.driver.licenceNumber, data.driver.licenceClass]
                        .filter(Boolean)
                        .join(' · '),
                      department: data.driver.department,
                      contact: data.driver.contactNumber,
                      id: data.driver.idNumber,
                    },
                  ]
                : []
            }
            emptyLabel="No main driver assigned"
          />
          {(data.additionalDrivers?.length || 0) > 0 ? (
            <View style={{ marginTop: 5 }}>
              <Text
                style={{
                  color: officialRedTheme.primary,
                  fontFamily: 'Helvetica-Bold',
                  fontSize: 6.7,
                  marginBottom: 2,
                }}
              >
                ADDITIONAL DRIVERS
              </Text>
              <DocumentTable
                theme={officialRedTheme}
                columns={[
                  { key: 'name', label: 'Driver name', width: '20%' },
                  { key: 'employee', label: 'Employee no.', width: '14%' },
                  { key: 'licence', label: 'Licence no.', width: '18%' },
                  { key: 'department', label: 'Department', width: '16%' },
                  { key: 'contact', label: 'Contact no.', width: '15%' },
                  { key: 'id', label: 'ID number', width: '17%' },
                ]}
                rows={(data.additionalDrivers || []).map((driver) => ({
                  name: driver.name,
                  employee: driver.employeeNumber,
                  licence: [driver.licenceNumber, driver.licenceClass].filter(Boolean).join(' · '),
                  department: driver.department,
                  contact: driver.contactNumber,
                  id: driver.idNumber,
                }))}
              />
            </View>
          ) : null}
        </DocumentSection>

        <DocumentSection title="D. Journey Details" theme={officialRedTheme}>
          <DocumentTable
            theme={officialRedTheme}
            columns={[
              { key: 'number', label: 'No.', width: '6%' },
              { key: 'from', label: 'From', width: '18%' },
              { key: 'to', label: 'To', width: '18%' },
              { key: 'departure', label: 'Departure', width: '23%' },
              { key: 'return', label: 'Return', width: '23%' },
              { key: 'km', label: 'Km', width: '12%', align: 'right' },
            ]}
            rows={
              legs.length
                ? legs.map((leg, index) => ({
                    number: index + 1,
                    from: leg.origin,
                    to: leg.destination,
                    departure: dateTime(leg.departureDate, leg.departureTime, locale),
                    return: dateTime(leg.returnDate, leg.returnTime, locale),
                    km:
                      leg.estimatedKm === undefined
                        ? undefined
                        : `${leg.estimatedKm.toLocaleString(locale)} km`,
                  }))
                : [
                    {
                      number: 1,
                      from: data.routeSummary,
                      to: undefined,
                      departure: formatHumanDate(data.startAt, locale),
                      return: formatHumanDate(data.endAt, locale),
                      km: data.totalKm ? `${data.totalKm.toLocaleString(locale)} km` : undefined,
                    },
                  ]
            }
          />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 3 }}>
            <Text style={{ width: '28%', fontFamily: 'Helvetica-Bold' }}>
              Total estimated distance
            </Text>
            <Text style={{ width: '15%', textAlign: 'right', fontFamily: 'Helvetica-Bold' }}>
              {data.totalKm ? `${data.totalKm.toLocaleString(locale)} km` : '—'}
            </Text>
          </View>
        </DocumentSection>

        <DocumentSection
          title={`E. Authorised Passengers${passengers.length ? ` (${passengers.length})` : ''}`}
          theme={officialRedTheme}
        >
          <DocumentTable
            theme={officialRedTheme}
            columns={[
              { key: 'number', label: 'No.', width: '6%' },
              { key: 'name', label: 'Name', width: '22%' },
              { key: 'employee', label: 'Employee no./ID', width: '18%' },
              { key: 'department', label: 'Department', width: '18%' },
              { key: 'contact', label: 'Contact no.', width: '18%' },
              { key: 'indemnity', label: 'Indemnity consent', width: '18%' },
            ]}
            rows={passengers.map((passenger, index) => ({
              number: index + 1,
              name: passenger.name,
              employee: passenger.employeeNumber || passenger.idNumber,
              department: passenger.department || passenger.organisation,
              contact: passenger.contactNumber,
              indemnity: passenger.indemnityConfirmed,
            }))}
            emptyLabel="No passengers authorised"
          />
        </DocumentSection>

        <DocumentSection
          title="F. Goods / Equipments"
          theme={officialRedTheme}
          minPresenceAhead={100}
          breakBefore={(data.goodsAndEquipment?.length || 0) > 10}
        >
          <DocumentTable
            theme={officialRedTheme}
            columns={[
              { key: 'description', label: 'Description', width: '30%' },
              { key: 'quantity', label: 'Quantity', width: '20%' },
              { key: 'purpose', label: 'Purpose', width: '50%' },
            ]}
            rows={(data.goodsAndEquipment || []).map((item) => ({
              description: item.description,
              quantity: item.quantity,
              purpose: item.purpose,
            }))}
            emptyLabel="No goods or equipment authorised"
          />
        </DocumentSection>

        <DocumentRow>
          <DocumentSection title="G. Special Conditions" theme={officialRedTheme} wrap={false}>
            {STANDARD_CONDITIONS.map((condition, index) => (
              <Text key={condition} style={{ marginBottom: 1.8, fontSize: 6.1 }}>
                {index + 1}. {condition}
              </Text>
            ))}
          </DocumentSection>
          <DocumentSection title="Special Authority" theme={officialRedTheme} wrap={false}>
            {specialAuthority.length ? (
              specialAuthority.map((condition, index) => (
                <Text key={`${condition}-${index}`} style={{ marginBottom: 1.8, fontSize: 6.1 }}>
                  {condition}
                </Text>
              ))
            ) : (
              <SafePdfText
                value="No additional special authority conditions recorded."
                style={documentStyles.muted}
              />
            )}
          </DocumentSection>
        </DocumentRow>

        <View style={documentStyles.finalBlock} wrap={false}>
          <DocumentSection title="H. Approvals" theme={officialRedTheme} wrap={false}>
            <View style={documentStyles.signatureRow}>
              <DocumentSignature
                statement="I confirm that the trip request has been reviewed and is approved."
                name={data.transportOfficer?.name}
                role={data.transportOfficer?.designation || 'Transport Officer'}
                signedAt={data.transportOfficer?.issuedAt}
                signatureUrl={data.transportOfficer?.signatureUrl}
              />
              <DocumentSignature
                statement="I authorise the use of the above vehicle for the specified trip."
                name={data.authoriser?.name}
                role={data.authoriser?.designation || 'Authorising Officer'}
                signedAt={data.authoriser?.authorisedAt}
                signatureUrl={data.authoriser?.signatureUrl}
              />
              <DocumentSignature
                statement="I acknowledge receipt of this Trip Authority and accept responsibility."
                name={data.driver?.name}
                role="Driver"
                signedAt={data.driver?.acceptedAt}
                signatureUrl={data.driver?.signatureUrl}
              />
            </View>
          </DocumentSection>
          <DocumentVerificationBlock
            branding={branding}
            verificationCode={data.verificationCode}
            verificationUrl={data.verificationUrl}
            documentHash={data.documentHash}
            qrCode={data.qrCodeDataUrl}
            theme={officialRedTheme}
          />
        </View>

        <DocumentWarnings items={OFFICIAL_WARNINGS} theme={officialRedTheme} />

        <DocumentVerificationFooter
          branding={branding}
          verificationCode={data.verificationCode || data.reference}
          verificationUrl={data.verificationUrl}
          theme={officialRedTheme}
        />
      </DocumentPage>
    </Document>
  );
};
