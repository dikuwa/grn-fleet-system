import { NotificationEmail } from './notification';
import * as React from 'react';

interface AuditNotificationEmailProps {
  tenantName?: string;
  recipientName: string;
  title: string;
  body: string;
  actionUrl?: string;
  entityType: string;
  entitySummary: string;
}

export function AuditNotificationEmail({
  tenantName,
  recipientName,
  title,
  body,
  actionUrl,
  entityType,
  entitySummary,
}: AuditNotificationEmailProps) {
  const typeLabels: Record<string, string> = {
    fuel_created: '⛽ Fuel Transaction',
    maintenance_created: '🔧 Maintenance Event',
    region_created: '🗺️ Region Created',
    region_updated: '🗺️ Region Updated',
    region_deleted: '🗺️ Region Deleted',
    trip_started: '🚗 Trip Started',
    trip_returned: '📥 Trip Returned',
    trip_closed: '📋 Trip Closed',
    allocation_created: '📦 Allocation Created',
    document_issued: '📄 Document Issued',
    document_superseded: '📄 Document Superseded',
  };

  const label = typeLabels[entityType] || entityType.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

  return (
    <NotificationEmail
      tenantName={tenantName}
      recipientName={recipientName}
      title={title}
      body={`${body}\n\n${label}: ${entitySummary}`}
      actionUrl={actionUrl}
    />
  );
}
