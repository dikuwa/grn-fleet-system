/**
 * Report Document — PDF document template
 *
 * Renders a formatted report PDF using @react-pdf/renderer with summary
 * tables and tenant branding. Used by the Reports API for PDF export.
 */

import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReportColumn {
  key: string;
  label: string;
}

export interface ReportData {
  title: string;
  period: string;
  tenantName?: string;
  tenantDocumentFooter?: string;
  generatedAt: string;
  summary?: { label: string; value: string }[];
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totalRowCount: number;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: 'Helvetica',
    fontSize: 9,
    lineHeight: 1.4,
    color: '#1a1a1a',
  },
  header: {
    borderBottomWidth: 2,
    borderBottomColor: '#0F766E',
    paddingBottom: 10,
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#0F766E',
    marginBottom: 2,
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
  metaItem: {
    fontSize: 8,
    color: '#6B7280',
  },
  metaValue: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  summarySection: {
    marginBottom: 16,
  },
  summaryTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#0F766E',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingBottom: 4,
    marginBottom: 8,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  summaryCard: {
    width: '22%',
    padding: 6,
    backgroundColor: '#F3F4F6',
    borderRadius: 4,
  },
  summaryLabel: {
    fontSize: 7,
    color: '#6B7280',
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  summaryValue: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  tableSection: {
    marginBottom: 16,
  },
  tableTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#0F766E',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingBottom: 4,
    marginBottom: 8,
  },
  table: {},
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#0F766E',
    padding: '5 6',
  },
  tableHeaderCell: {
    fontSize: 7,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    padding: '4 6',
  },
  tableRowAlt: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    padding: '4 6',
    backgroundColor: '#F9FAFB',
  },
  tableCell: {
    fontSize: 8,
    color: '#1a1a1a',
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
    paddingTop: 6,
  },
  pageNumber: {
    position: 'absolute',
    bottom: 30,
    right: 40,
    fontSize: 7,
    color: '#9CA3AF',
  },
});

// ---------------------------------------------------------------------------
// Document Component
// ---------------------------------------------------------------------------

export const ReportDocument: React.FC<{ data: ReportData }> = ({ data }) => {
  const colWidth = `${Math.max(10, Math.floor(80 / Math.max(data.columns.length, 1)))}%`;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{data.title}</Text>
          <Text style={styles.headerSubtitle}>
            {data.tenantName || 'Fleet Management System'}
          </Text>
        </View>

        {/* Meta Info */}
        <View style={styles.metaRow}>
          <View>
            <Text style={styles.metaItem}>Period</Text>
            <Text style={styles.metaValue}>{data.period}</Text>
          </View>
          <View>
            <Text style={styles.metaItem}>Generated</Text>
            <Text style={styles.metaValue}>{data.generatedAt}</Text>
          </View>
          <View>
            <Text style={styles.metaItem}>Total Records</Text>
            <Text style={styles.metaValue}>{data.totalRowCount}</Text>
          </View>
        </View>

        {/* Summary Cards */}
        {data.summary && data.summary.length > 0 && (
          <View style={styles.summarySection}>
            <Text style={styles.summaryTitle}>Summary</Text>
            <View style={styles.summaryGrid}>
              {data.summary.map((item, i) => (
                <View key={i} style={styles.summaryCard}>
                  <Text style={styles.summaryLabel}>{item.label}</Text>
                  <Text style={styles.summaryValue}>{item.value}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Data Table */}
        {data.rows.length > 0 && (
          <View style={styles.tableSection}>
            <Text style={styles.tableTitle}>Records</Text>
            <View style={styles.table}>
              {/* Header Row */}
              <View style={styles.tableHeader}>
                {data.columns.map((col) => (
                  <Text
                    key={col.key}
                    style={[styles.tableHeaderCell, { width: colWidth }]}
                  >
                    {col.label}
                  </Text>
                ))}
              </View>

              {/* Data Rows */}
              {data.rows.slice(0, 50).map((row, i) => (
                <View
                  key={i}
                  style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}
                >
                  {data.columns.map((col) => (
                    <Text
                      key={col.key}
                      style={[styles.tableCell, { width: colWidth }]}
                    >
                      {String(row[col.key] ?? '')}
                    </Text>
                  ))}
                </View>
              ))}

              {/* Note if truncated */}
              {data.rows.length > 50 && (
                <View style={{ padding: 6 }}>
                  <Text style={{ fontSize: 7, color: '#6B7280', fontStyle: 'italic' }}>
                    Showing first 50 of {data.rows.length} records.
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Empty State */}
        {data.rows.length === 0 && (
          <View style={{ padding: 20, alignItems: 'center' }}>
            <Text style={{ fontSize: 10, color: '#9CA3AF' }}>
              No records found for the selected period.
            </Text>
          </View>
        )}

        {/* Footer */}
        <Text style={styles.footer}>
          {data.tenantDocumentFooter || 'Fleet Management System — Generated Report'}
        </Text>
        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) =>
            `${pageNumber} / ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
};
