/**
 * Inspection Report — PDF document template
 *
 * Renders an official Vehicle Inspection Report using @react-pdf/renderer.
 * Generated when a departure or return inspection is completed.
 */

import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InspectionItemResult {
  label: string;
  category: string;
  result: 'pass' | 'fail' | 'not_applicable';
  comment?: string;
}

export interface InspectionReportData {
  inspectionId: string;
  type: 'departure' | 'return';
  vehicle: {
    licenceNumber: string;
    registrationNumber: string;
  };
  odometerReading?: number | null;
  fuelLevel?: string | null;
  overallPass?: boolean | null;
  status: string;
  notes?: string | null;
  inspectedAt: string;
  inspectorName?: string;
  driverName?: string;
  tenantName?: string;
  tenantDocumentFooter?: string;
  items?: InspectionItemResult[];
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
    borderBottomColor: '#0F766E',
    paddingBottom: 12,
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0F766E',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#4B5563',
  },
  badgeRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 16,
  },
  badge: {
    padding: '4 12',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  badgePass: {
    backgroundColor: '#D1FAE5',
    color: '#065F46',
  },
  badgeFail: {
    backgroundColor: '#FEE2E2',
    color: '#991B1B',
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#0F766E',
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
    width: 120,
    color: '#6B7280',
    fontSize: 10,
  },
  value: {
    flex: 1,
    fontSize: 10,
    color: '#1a1a1a',
  },
  statusCard: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  stat: {
    flex: 1,
    padding: 8,
    backgroundColor: '#F9FAFB',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  statLabel: {
    fontSize: 8,
    color: '#6B7280',
    marginBottom: 2,
  },
  statValue: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  table: {
    marginTop: 8,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    padding: '6 8',
  },
  tableHeaderCell: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#6B7280',
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    padding: '6 8',
  },
  tableCell: {
    fontSize: 9,
    color: '#1a1a1a',
  },
  colCategory: { width: '20%' },
  colItem: { width: '35%' },
  colResult: { width: '15%' },
  colComment: { width: '30%' },
  resultPass: { color: '#065F46', fontWeight: 'bold' },
  resultFail: { color: '#991B1B', fontWeight: 'bold' },
  resultNa: { color: '#9CA3AF' },
  notes: {
    marginTop: 12,
    padding: 10,
    backgroundColor: '#F9FAFB',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  notesLabel: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#4B5563',
    marginBottom: 4,
  },
  notesText: {
    fontSize: 9,
    color: '#1a1a1a',
  },
  signatures: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 24,
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
});

// ---------------------------------------------------------------------------
// Document Component
// ---------------------------------------------------------------------------

export const InspectionReportDocument: React.FC<{ data: InspectionReportData }> = ({ data }) => {
  const items = data.items || [];
  const passCount = items.filter((i) => i.result === 'pass').length;
  const failCount = items.filter((i) => i.result === 'fail').length;
  const naCount = items.filter((i) => i.result === 'not_applicable').length;

  const overallStatus = data.overallPass === null
    ? 'PENDING'
    : data.overallPass
      ? 'PASS'
      : 'FAIL';

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>VEHICLE INSPECTION REPORT</Text>
          <Text style={styles.headerSubtitle}>
            {data.tenantName || 'Regional Council Fleet Management'} —{' '}
            {data.type === 'departure' ? 'Departure Inspection' : 'Return Inspection'}
          </Text>
        </View>

        {/* Status Badge */}
        <View style={styles.badgeRow}>
          <Text style={[styles.badge, overallStatus === 'PASS' ? styles.badgePass : styles.badgeFail]}>
            {overallStatus}
          </Text>
        </View>

        {/* Vehicle Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Vehicle & Inspection Info</Text>
          <View style={styles.statusCard}>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Vehicle</Text>
              <Text style={styles.statValue}>{data.vehicle.licenceNumber}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Register No.</Text>
              <Text style={styles.statValue}>{data.vehicle.registrationNumber}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Odometer</Text>
              <Text style={styles.statValue}>{data.odometerReading ?? '—'} km</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Fuel</Text>
              <Text style={styles.statValue}>{data.fuelLevel ?? '—'}</Text>
            </View>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Inspector</Text>
            <Text style={styles.value}>{data.inspectorName || 'N/A'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Driver</Text>
            <Text style={styles.value}>{data.driverName || 'N/A'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Inspected At</Text>
            <Text style={styles.value}>{data.inspectedAt}</Text>
          </View>
        </View>

        {/* Results Summary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Results Summary</Text>
          <View style={styles.statusCard}>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Pass</Text>
              <Text style={[styles.statValue, { color: '#065F46' }]}>{passCount}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Fail</Text>
              <Text style={[styles.statValue, { color: '#991B1B' }]}>{failCount}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>N/A</Text>
              <Text style={[styles.statValue, { color: '#9CA3AF' }]}>{naCount}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Total</Text>
              <Text style={styles.statValue}>{items.length}</Text>
            </View>
          </View>
        </View>

        {/* Inspection Checklist Table */}
        {items.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Checklist</Text>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderCell, styles.colCategory]}>Category</Text>
                <Text style={[styles.tableHeaderCell, styles.colItem]}>Item</Text>
                <Text style={[styles.tableHeaderCell, styles.colResult]}>Result</Text>
                <Text style={[styles.tableHeaderCell, styles.colComment]}>Comment</Text>
              </View>
              {items.map((item, i) => (
                <View key={i} style={styles.tableRow}>
                  <Text style={[styles.tableCell, styles.colCategory]}>{item.category}</Text>
                  <Text style={[styles.tableCell, styles.colItem]}>{item.label}</Text>
                  <Text style={[
                    styles.tableCell,
                    styles.colResult,
                    item.result === 'pass' ? styles.resultPass :
                    item.result === 'fail' ? styles.resultFail : styles.resultNa,
                  ]}>
                    {item.result === 'pass' ? 'PASS' : item.result === 'fail' ? 'FAIL' : 'N/A'}
                  </Text>
                  <Text style={[styles.tableCell, styles.colComment]}>{item.comment || ''}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Notes */}
        {data.notes && (
          <View style={styles.notes}>
            <Text style={styles.notesLabel}>Inspector Notes</Text>
            <Text style={styles.notesText}>{data.notes}</Text>
          </View>
        )}

        {/* Signatures */}
        <View style={styles.signatures}>
          <View style={styles.signatureBlock}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>Inspector Signature / Date</Text>
          </View>
          <View style={styles.signatureBlock}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>Driver Acknowledgement / Date</Text>
          </View>
        </View>

        {/* Footer */}
        <Text style={styles.footer}>
          {data.tenantDocumentFooter || 'Kavango East Regional Council — Fleet Management'}
        </Text>
      </Page>
    </Document>
  );
};
