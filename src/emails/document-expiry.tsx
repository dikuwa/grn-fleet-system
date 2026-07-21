import { NotificationEmail } from './notification';
import * as React from 'react';

interface DocumentExpiryEmailProps {
  tenantName?: string;
  recipientName: string;
  documentType: string;
  documentReference: string;
  expiryDate: string;
  daysRemaining: number;
  actionUrl?: string;
  vehicleLicence?: string;
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  transport_request: 'Transport Request',
  trip_authority: 'Trip Authority',
  vehicle_allocation: 'Vehicle Allocation',
  fuel_summary: 'Fuel Summary',
  inspection_report: 'Inspection Report',
  trip_completion: 'Trip Completion',
  maintenance_report: 'Maintenance Report',
  audit_report: 'Audit Report',
};

export function DocumentExpiryEmail({
  tenantName,
  recipientName,
  documentType,
  documentReference,
  expiryDate,
  daysRemaining,
  actionUrl,
  vehicleLicence,
}: DocumentExpiryEmailProps) {
  const label = DOCUMENT_TYPE_LABELS[documentType] || documentType.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
  const isExpired = daysRemaining <= 0;

  const title = isExpired
    ? `⚠️ Document Expired: ${label}`
    : `📄 Document Expiring: ${label} (${daysRemaining} days)`;

  const body = vehicleLicence
    ? `${label}${documentReference ? ` (${documentReference})` : ''} for vehicle ${vehicleLicence} ${isExpired ? `expired on ${expiryDate}` : `will expire on ${expiryDate} (${daysRemaining} days remaining)`}. Please review and take appropriate action.`
    : `${label}${documentReference ? ` (${documentReference})` : ''} ${isExpired ? `expired on ${expiryDate}` : `will expire on ${expiryDate} (${daysRemaining} days remaining)`}. Please review and take appropriate action.`;

  return (
    <NotificationEmail
      tenantName={tenantName}
      recipientName={recipientName}
      title={title}
      body={body}
      actionUrl={actionUrl}
      isEmergency={isExpired}
    />
  );
}
