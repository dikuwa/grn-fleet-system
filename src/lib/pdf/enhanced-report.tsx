/**
 * Enhanced Analytics PDF Document
 *
 * Structured PDF rendering of the five Enhanced Analytics metrics
 * (approval turnaround, vehicle utilisation, fuel efficiency, late
 * returns, rejection metrics) with tenant/period metadata and
 * "Page X of Y" footers on every page.
 *
 * Charts are rendered as readable tabular breakdowns so the PDF stays
 * fully legible in print without relying on screenshots.
 */

import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { DOCUMENT_FONT_STACK } from './document-system';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnhancedReportData {
  title: string;
  periodLabel: string;
  tenantName?: string;
  tenantDocumentFooter?: string;
  generatedAt: string;
  filters: { label: string; value: string }[];
  kpis: { label: string; value: string }[];
  sections: {
    key: string;
    title: string;
    columns: { key: string; label: string }[];
    rows: Record<string, unknown>[];
    emptyText?: string;
  }[];
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    padding: 40,
    paddingBottom: 60,
    fontFamily: DOCUMENT_FONT_STACK,
    fontSize: 9,
    lineHeight: 1.4,
    color: '#1a1a1a',
  },
  header: {
    borderBottomWidth: 2,
    borderBottomColor: '#0F766E',
    paddingBottom: 10,
    marginBottom: 14,
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
    marginBottom: 6,
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
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 12,
  },
  filterChip: {
    fontSize: 8,
    color: '#374151',
    padding: '2 6',
    backgroundColor: '#F3F4F6',
    borderRadius: 3,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  kpiCard: {
    width: '23%',
    padding: 7,
    backgroundColor: '#F3F4F6',
    borderRadius: 4,
  },
  kpiLabel: {
    fontSize: 7,
    color: '#6B7280',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  kpiValue: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#0F766E',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingBottom: 4,
    marginBottom: 8,
  },
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
  emptyText: {
    fontSize: 9,
    color: '#9CA3AF',
    padding: 8,
  },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 6,
  },
  footerLeft: {
    width: '78%',
    fontSize: 7,
    color: '#9CA3AF',
  },
  footerRight: {
    width: '22%',
    fontSize: 7,
    color: '#9CA3AF',
    textAlign: 'right',
  },
});

// ---------------------------------------------------------------------------
// Document Component
// ---------------------------------------------------------------------------

export const EnhancedReportDocument: React.FC<{ data: EnhancedReportData }> = ({
  data,
}) => {
  return (
    <Document title={data.title} author={data.tenantName || 'Government Fleet'}>
      <Page size="A4" style={styles.page} wrap>
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
            <Text style={styles.metaValue}>{data.periodLabel}</Text>
          </View>
          <View>
            <Text style={styles.metaItem}>Generated</Text>
            <Text style={styles.metaValue}>{data.generatedAt}</Text>
          </View>
        </View>

        {/* Active Filters */}
        {data.filters.length > 0 && (
          <View style={styles.filterRow}>
            {data.filters.map((f, i) => (
              <Text key={i} style={styles.filterChip}>
                {f.label}: {f.value}
              </Text>
            ))}
          </View>
        )}

        {/* KPI Summary */}
        {data.kpis.length > 0 && (
          <View style={styles.kpiGrid}>
            {data.kpis.map((kpi, i) => (
              <View key={i} style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>{kpi.label}</Text>
                <Text style={styles.kpiValue}>{kpi.value}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Sections */}
        {data.sections.map((section) => {
          const colWidth = `${Math.max(
            12,
            Math.floor(84 / Math.max(section.columns.length, 1)),
          )}%`;
          return (
            <View key={section.key} style={styles.section} wrap>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              {section.rows.length === 0 ? (
                <Text style={styles.emptyText}>
                  {section.emptyText || 'No data recorded for the selected period.'}
                </Text>
              ) : (
                <View wrap>
                  <View style={styles.tableHeader} fixed>
                    {section.columns.map((col) => (
                      <Text key={col.key} style={[styles.tableHeaderCell, { width: colWidth }]}>
                        {col.label}
                      </Text>
                    ))}
                  </View>
                  {section.rows.map((row, i) => (
                    <View
                      key={i}
                      style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}
                      wrap={false}
                    >
                      {section.columns.map((col) => (
                        <Text key={col.key} style={[styles.tableCell, { width: colWidth }]}>
                          {String(row[col.key] ?? '')}
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })}

        {/* Fixed footer: React-PDF render callbacks belong on Text, not on a Text that returns a View. */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerLeft}>
            {data.tenantDocumentFooter ||
              `${data.tenantName || 'Fleet Management System'} — Enhanced Analytics`}
          </Text>
          <Text
            style={styles.footerRight}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
};
