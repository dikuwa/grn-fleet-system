/**
 * Snapshot Document — Generic PDF document template
 *
 * Renders any document snapshot data as a formatted A4 PDF using
 * @react-pdf/renderer. Works with all document types (transport_request,
 * trip_authority, vehicle_history, audit_report, etc.).
 *
 * Falls back gracefully for deep/nested snapshot structures by flattening
 * them into summary sections.
 */

import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SnapshotDocumentData {
  documentType: string;
  documentVersion: number;
  tenantName?: string;
  tenantDocumentFooter?: string;
  snapshotData: Record<string, unknown>;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: 'Helvetica',
    fontSize: 9,
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
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1F4E8C',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 10,
    color: '#4B5563',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    padding: 8,
    backgroundColor: '#F9FAFB',
    borderRadius: 4,
  },
  section: {
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#1F4E8C',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingBottom: 4,
    marginBottom: 8,
  },
  fieldRow: {
    flexDirection: 'row',
    marginBottom: 3,
    paddingVertical: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: '#F3F4F6',
  },
  fieldLabel: {
    width: 140,
    color: '#6B7280',
    fontSize: 9,
  },
  fieldValue: {
    flex: 1,
    fontSize: 9,
    color: '#1a1a1a',
  },
  nestedBlock: {
    marginTop: 6,
    padding: 8,
    backgroundColor: '#F9FAFB',
    borderRadius: 4,
  },
  nestedTitle: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#4B5563',
    marginBottom: 4,
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: 'center',
    fontSize: 7,
    color: '#9CA3AF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 8,
  },
  pageNumber: {
    position: 'absolute',
    bottom: 30,
    right: 40,
    fontSize: 7,
    color: '#9CA3AF',
  },
  badge: {
    padding: '2 8',
    borderRadius: 3,
    fontSize: 8,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  badgePass: { backgroundColor: '#D1FAE5', color: '#065F46' },
  badgeFail: { backgroundColor: '#FEE2E2', color: '#991B1B' },
  badgeInfo: { backgroundColor: '#DBEAFE', color: '#1E40AF' },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a value for display — handles objects, arrays, strings, numbers, null. */
function formatValue(value: unknown, indent = 0): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'None';
    // For primitive arrays, join with commas
    if (value.length > 0 && typeof value[0] !== 'object') {
      return value.join(', ');
    }
    // Object arrays — show count
    return `${value.length} item${value.length !== 1 ? 's' : ''}`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '—';
    return `${entries.length} field${entries.length !== 1 ? 's' : ''}`;
  }
  return String(value);
}

/** Check if a value is a simple scalar (not array/object). */
function isScalar(value: unknown): boolean {
  return value === null || value === undefined || typeof value === 'string' ||
    typeof value === 'number' || typeof value === 'boolean';
}

/** Extract top-level scalar fields from an object (skip nested arrays/objects). */
function getScalarFields(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isScalar(value)) {
      result[key] = value;
    }
  }
  return result;
}

/** Extract nested structures (arrays/objects) for summary sections. */
function getNestedFields(obj: Record<string, unknown>): Record<string, unknown[]> {
  const result: Record<string, unknown[]> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      result[key] = value;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Document Component
// ---------------------------------------------------------------------------

export const SnapshotDocument: React.FC<{ data: SnapshotDocumentData }> = ({ data }) => {
  const scalars = getScalarFields(data.snapshotData);
  const nested = getNestedFields(data.snapshotData);

  const displayType = data.documentType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c: string) => c.toUpperCase());

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{displayType}</Text>
          <Text style={styles.headerSubtitle}>
            {data.tenantName || 'Fleet Management System'} — v{data.documentVersion}
          </Text>
        </View>

        {/* Meta */}
        <View style={styles.metaRow}>
          <View>
            <Text style={{ fontSize: 8, color: '#6B7280' }}>Document Type</Text>
            <Text style={{ fontSize: 10, fontWeight: 'bold', color: '#1F4E8C' }}>{displayType}</Text>
          </View>
          <View>
            <Text style={{ fontSize: 8, color: '#6B7280' }}>Version</Text>
            <Text style={{ fontSize: 10, fontWeight: 'bold' }}>{data.documentVersion}</Text>
          </View>
          <View>
            <Text style={{ fontSize: 8, color: '#6B7280' }}>Generated</Text>
            <Text style={{ fontSize: 10, fontWeight: 'bold' }}>{data.generatedAt.split('T')[0]}</Text>
          </View>
        </View>

        {/* Scalar Fields */}
        {Object.keys(scalars).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Details</Text>
            {Object.entries(scalars).map(([key, value]) => {
              const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
              const formatted = formatValue(value);

              // Render status fields as badges
              if (key === 'status' || key === 'overallPass' || key === 'decision') {
                const badgeStyle = value === 'pass' || value === true || value === 'approved'
                  ? styles.badgePass
                  : value === 'fail' || value === false || value === 'rejected'
                    ? styles.badgeFail
                    : styles.badgeInfo;
                return (
                  <View key={key} style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>{label}</Text>
                    <Text style={[styles.fieldValue, { fontWeight: 'bold' }, badgeStyle]}>{formatted}</Text>
                  </View>
                );
              }

              return (
                <View key={key} style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>{label}</Text>
                  <Text style={styles.fieldValue}>{formatted}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Nested Fields (Arrays) */}
        {Object.entries(nested).map(([key, arr]) => {
          const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
          if (arr.length === 0) return null;

          return (
            <View key={key} style={styles.section}>
              <Text style={styles.sectionTitle}>
                {label} ({arr.length})
              </Text>

              {/* For each item in the array, show its scalar fields */}
              {arr.slice(0, 5).map((item, idx) => {
                if (!item || typeof item !== 'object') {
                  return (
                    <View key={idx} style={styles.nestedBlock}>
                      <Text style={{ fontSize: 8, color: '#6B7280' }}>Item {idx + 1}</Text>
                      <Text style={{ fontSize: 9 }}>{String(item)}</Text>
                    </View>
                  );
                }
                const obj = item as Record<string, unknown>;
                const itemScalars = getScalarFields(obj);

                return (
                  <View key={idx} style={styles.nestedBlock}>
                    <Text style={styles.nestedTitle}>Item {idx + 1}</Text>
                    {Object.entries(itemScalars).map(([fk, fv]) => {
                      const flabel = fk.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
                      return (
                        <View key={fk} style={{ flexDirection: 'row', marginBottom: 1 }}>
                          <Text style={{ width: 100, fontSize: 8, color: '#6B7280' }}>{flabel}</Text>
                          <Text style={{ fontSize: 8, color: '#1a1a1a' }}>{formatValue(fv)}</Text>
                        </View>
                      );
                    })}
                  </View>
                );
              })}

              {arr.length > 5 && (
                <Text style={{ fontSize: 8, color: '#9CA3AF', fontStyle: 'italic', marginTop: 4 }}>
                  ...and {arr.length - 5} more
                </Text>
              )}
            </View>
          );
        })}

        {/* Footer */}
        <Text style={styles.footer}>
          {data.tenantDocumentFooter || 'Fleet Management System — Generated Document'}
        </Text>
        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
};
