/**
 * Trip Authority — PDF document template
 *
 * Renders an official Trip Authority document using @react-pdf/renderer.
 * Generated when a vehicle is allocated and issued for a trip.
 */

import React from 'react';
import { Document, Image, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TripAuthorityData {
  reference: string;
  tenantName?: string;
  tenantDocumentFooter?: string;
  vehicle: {
    licenceNumber: string;
    vehicleRegisterNumber: string;
    make: string;
    model: string;
  };
  requestReference: string;
  scope: string;
  startAt: string;
  endAt: string;
  allocatedByUserId?: string;
  requesterName?: string;
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
    licenceNumber?: string;
    licenceClass?: string;
    licenceExpiry?: string;
    acceptedAt?: string;
  };
  passengers?: Array<{
    name: string;
    employeeNumber?: string;
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
  };
  routeEntries?: Array<{ occurredAt: string; type: string; location?: string; odometer?: number; note?: string }>;
  defects?: Array<{ severity: string; description: string; status?: string }>;
  incidents?: Array<{ type: string; occurredAt: string; description: string; safeToContinue: boolean }>;
  arrivalInspection?: { status: string; odometer?: number; completedAt?: string };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: 'Helvetica',
    fontSize: 10,
    lineHeight: 1.5,
    color: '#1a1a1a',
  },
  header: {
    borderBottomWidth: 2,
    borderBottomColor: '#1F4E8C',
    paddingBottom: 12,
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1F4E8C',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#4B5563',
  },
  referenceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    padding: 10,
    backgroundColor: '#F3F4F6',
    borderRadius: 4,
  },
  referenceLabel: {
    fontSize: 9,
    color: '#6B7280',
    marginBottom: 2,
  },
  referenceValue: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#1F4E8C',
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#1F4E8C',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingBottom: 4,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  label: {
    width: 140,
    color: '#6B7280',
    fontSize: 10,
  },
  value: {
    flex: 1,
    fontSize: 10,
    color: '#1a1a1a',
  },
  vehicleDetails: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  vehicleCard: {
    flex: 1,
    padding: 8,
    backgroundColor: '#F9FAFB',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  vehicleLabel: {
    fontSize: 8,
    color: '#6B7280',
    marginBottom: 2,
  },
  vehicleValue: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: 'center',
    fontSize: 8,
    color: '#9CA3AF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 8,
  },
  stamp: {
    marginTop: 24,
    padding: 12,
    borderWidth: 2,
    borderColor: '#1F4E8C',
    borderStyle: 'dashed',
    borderRadius: 4,
  },
  stampTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#1F4E8C',
    marginBottom: 4,
  },
  stampText: {
    fontSize: 9,
    color: '#4B5563',
  },
  signatureRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  signatureBlock: {
    width: '45%',
  },
  signatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    marginTop: 24,
    marginBottom: 4,
  },
  signatureLabel: {
    fontSize: 8,
    color: '#6B7280',
  },
  qr: { width: 72, height: 72 },
  compactRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#D1D5DB', paddingVertical: 4 },
  compactIndex: { width: 24, color: '#6B7280' },
  compactMain: { flex: 1 },
  compactMeta: { width: 120, color: '#4B5563', fontSize: 8 },
  pageNumber: { position: 'absolute', bottom: 14, right: 40, fontSize: 8, color: '#9CA3AF' },
});

// ---------------------------------------------------------------------------
// Document Component
// ---------------------------------------------------------------------------

export const TripAuthorityDocument: React.FC<{ data: TripAuthorityData }> = ({ data }) => (
  <Document>
    <Page size="A4" style={styles.page}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>TRIP AUTHORITY</Text>
        <Text style={styles.headerSubtitle}>{data.tenantName || 'Regional Council Fleet Management'}</Text>
      </View>

      {/* Reference */}
      <View style={styles.referenceRow}>
        <View>
          <Text style={styles.referenceLabel}>Authority Reference</Text>
          <Text style={styles.referenceValue}>TA-{data.reference}</Text>
        </View>
        <View>
          <Text style={styles.referenceLabel}>Request Reference</Text>
          <Text style={styles.referenceValue}>{data.requestReference}</Text>
        </View>
        {data.qrCodeDataUrl && <Image src={data.qrCodeDataUrl} style={styles.qr} />}
      </View>

      {/* Trip Details */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Trip Details</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Scope</Text>
          <Text style={styles.value}>{data.scope === 'national' ? 'National' : 'Regional'}</Text>
        </View>
        {data.driver && (
          <>
            <View style={styles.row}><Text style={styles.label}>Primary Driver</Text><Text style={styles.value}>{data.driver.name}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Driver Licence</Text><Text style={styles.value}>{[data.driver.licenceNumber, data.driver.licenceClass, data.driver.licenceExpiry].filter(Boolean).join(' · ')}</Text></View>
          </>
        )}
        <View style={styles.row}>
          <Text style={styles.label}>Purpose</Text>
          <Text style={styles.value}>{data.purpose || 'Not specified'}</Text>
        </View>
        {data.requesterName && (
          <View style={styles.row}>
            <Text style={styles.label}>Requester</Text>
            <Text style={styles.value}>{data.requesterName}</Text>
          </View>
        )}
        {data.routeSummary && (
          <View style={styles.row}>
            <Text style={styles.label}>Route</Text>
            <Text style={styles.value}>{data.routeSummary}</Text>
          </View>
        )}
        {data.totalKm && (
          <View style={styles.row}>
            <Text style={styles.label}>Total Distance</Text>
            <Text style={styles.value}>{data.totalKm} km</Text>
          </View>
        )}
        <View style={styles.row}>
          <Text style={styles.label}>Start Date</Text>
          <Text style={styles.value}>{data.startAt}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>End Date</Text>
          <Text style={styles.value}>{data.endAt}</Text>
        </View>
      </View>

      {/* Vehicle Details */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Assigned Vehicle</Text>
        <View style={styles.vehicleDetails}>
          <View style={styles.vehicleCard}>
            <Text style={styles.vehicleLabel}>Licence / Plate</Text>
            <Text style={styles.vehicleValue}>{data.vehicle.licenceNumber}</Text>
          </View>
          <View style={styles.vehicleCard}>
            <Text style={styles.vehicleLabel}>Register Number</Text>
            <Text style={styles.vehicleValue}>{data.vehicle.vehicleRegisterNumber}</Text>
          </View>
          <View style={styles.vehicleCard}>
            <Text style={styles.vehicleLabel}>Make / Model</Text>
            <Text style={styles.vehicleValue}>{data.vehicle.make} {data.vehicle.model}</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Authority Control</Text>
        <View style={styles.row}><Text style={styles.label}>Document Status</Text><Text style={styles.value}>{data.authorityStatus || 'Issued'}</Text></View>
        <View style={styles.row}><Text style={styles.label}>Document Version</Text><Text style={styles.value}>v{data.documentVersion || 1}</Text></View>
        <View style={styles.row}><Text style={styles.label}>Special Conditions</Text><Text style={styles.value}>{data.specialConditions || 'None recorded'}</Text></View>
        <View style={styles.row}><Text style={styles.label}>Odometer</Text><Text style={styles.value}>{data.beginningOdometer ?? 'Pending'} → {data.endingOdometer ?? 'Pending'}</Text></View>
      </View>

      {/* Authority Stamp */}
      <View style={styles.stamp}>
        <Text style={styles.stampTitle}>AUTHORISATION</Text>
        <Text style={styles.stampText}>
          This Trip Authority is issued in accordance with the Regional Council Transport Policy.
          The above-named vehicle is released for official use for the specified trip period.
        </Text>
      </View>

      {/* Signatures */}
      <View style={styles.signatureRow}>
        <View style={styles.signatureBlock}>
          <View style={styles.signatureLine} />
          <Text style={styles.signatureLabel}>Transport Officer / Date</Text>
        </View>
        <View style={styles.signatureBlock}>
          <View style={styles.signatureLine} />
          <Text style={styles.signatureLabel}>Authorising Officer / Date</Text>
        </View>
      </View>

      {/* Footer */}
      <Text style={styles.footer}>
        {data.tenantDocumentFooter || 'Kavango East Regional Council — Fleet Management'}
      </Text>
      <Text style={styles.pageNumber}>Page 1 of 2 · Generated {new Date().toLocaleString('en-NA')}</Text>
    </Page>

    <Page size="A4" style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>TRIP AUTHORITY — OPERATIONAL RECORD</Text>
        <Text style={styles.headerSubtitle}>{data.reference} · Version {data.documentVersion || 1}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Authorised Passengers ({data.passengers?.length || 0})</Text>
        {(data.passengers || []).length ? data.passengers!.map((passenger, index) => (
          <View key={`${passenger.name}-${index}`} style={styles.compactRow}>
            <Text style={styles.compactIndex}>{index + 1}.</Text>
            <Text style={styles.compactMain}>{passenger.name}{passenger.employeeNumber ? ` · ${passenger.employeeNumber}` : ''}</Text>
            <Text style={styles.compactMeta}>{passenger.passengerType || 'Passenger'} · {passenger.destination || 'Approved destination'}</Text>
          </View>
        )) : <Text>No passengers authorised.</Text>}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Additional Authorised Drivers</Text>
        {(data.additionalDrivers || []).length ? data.additionalDrivers!.map((driver, index) => (
          <View key={`${driver.name}-${index}`} style={styles.compactRow}>
            <Text style={styles.compactIndex}>{index + 1}.</Text>
            <Text style={styles.compactMain}>{driver.name}{driver.employeeNumber ? ` · ${driver.employeeNumber}` : ''}</Text>
            <Text style={styles.compactMeta}>{driver.licenceClass || 'Licence class not recorded'} · {driver.licenceExpiry || 'No expiry'}</Text>
          </View>
        )) : <Text>No additional drivers authorised.</Text>}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Route and Stop Entries</Text>
        {(data.routeEntries || []).length ? data.routeEntries!.slice(0, 18).map((entry, index) => (
          <View key={`${entry.occurredAt}-${index}`} style={styles.compactRow}>
            <Text style={styles.compactIndex}>{index + 1}.</Text>
            <Text style={styles.compactMain}>{entry.type.replace(/_/g, ' ')} · {entry.location || 'Location not recorded'}</Text>
            <Text style={styles.compactMeta}>{entry.occurredAt}{entry.odometer ? ` · ${entry.odometer} km` : ''}</Text>
          </View>
        )) : <Text>No operational route entries recorded.</Text>}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Defects and Incidents</Text>
        {(data.defects || []).map((defect, index) => <Text key={`defect-${index}`}>• {defect.severity}: {defect.description}</Text>)}
        {(data.incidents || []).map((incident, index) => <Text key={`incident-${index}`}>• {incident.type}: {incident.description} ({incident.safeToContinue ? 'safe to continue' : 'continuation blocked'})</Text>)}
        {!(data.defects || []).length && !(data.incidents || []).length && <Text>No defects or incidents recorded.</Text>}
      </View>

      <View style={styles.stamp}>
        <Text style={styles.stampTitle}>DIGITAL VERIFICATION</Text>
        <Text style={styles.stampText}>Verification code: {data.verificationCode || 'Not available'}</Text>
        <Text style={styles.stampText}>{data.verificationUrl || 'Use the QR code on page 1 to verify the current authority status.'}</Text>
      </View>

      <Text style={styles.footer}>{data.tenantDocumentFooter || 'Official government fleet record'}</Text>
      <Text style={styles.pageNumber}>Page 2 of 2 · Generated {new Date().toLocaleString('en-NA')}</Text>
    </Page>
  </Document>
);
