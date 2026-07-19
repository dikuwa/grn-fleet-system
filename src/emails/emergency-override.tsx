import { NotificationEmail } from './notification';
import * as React from 'react';

interface EmergencyOverrideEmailProps {
  tenantName?: string;
  recipientName: string;
  requestReference: string;
  reason: string;
  requestUrl?: string;
}

export function EmergencyOverrideEmail({
  tenantName,
  recipientName,
  requestReference,
  reason,
  requestUrl,
}: EmergencyOverrideEmailProps) {
  return (
    <NotificationEmail
      tenantName={tenantName}
      recipientName={recipientName}
      title="⚠️ Emergency Override Applied"
      body={`An emergency override has been applied to transport request ${requestReference}. Reason: ${reason}. Please note that a post-trip review has been flagged and is required.`}
      actionUrl={requestUrl}
      isEmergency
    />
  );
}
