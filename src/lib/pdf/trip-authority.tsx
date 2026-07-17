/**
 * Trip Authority — PDF document template
 *
 * Renders an official Trip Authority document using @react-pdf/renderer.
 * Generated when a vehicle is allocated and issued for a trip.
 */

import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

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
      </View>

      {/* Trip Details */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Trip Details</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Scope</Text>
          <Text style={styles.value}>{data.scope === 'national' ? 'National' : 'Regional'}</Text>
        </View>
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
    </Page>
  </Document>
);
