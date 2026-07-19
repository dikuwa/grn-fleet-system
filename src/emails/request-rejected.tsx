import { NotificationEmail } from './notification';
import * as React from 'react';

interface RequestRejectedEmailProps {
  tenantName?: string;
  recipientName: string;
  requestReference: string;
  reason?: string;
  requestUrl?: string;
}

export function RequestRejectedEmail({
  tenantName,
  recipientName,
  requestReference,
  reason,
  requestUrl,
}: RequestRejectedEmailProps) {
  const body = reason
    ? `Your transport request ${requestReference} was not approved. Reason: ${reason}`
    : `Your transport request ${requestReference} was not approved. Please review and resubmit.`;

  return (
    <NotificationEmail
      tenantName={tenantName}
      recipientName={recipientName}
      title="❌ Transport Request Not Approved"
      body={body}
      actionUrl={requestUrl}
      isEmergency
    />
  );
}
