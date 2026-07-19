import { NotificationEmail } from './notification';
import * as React from 'react';

interface RequestApprovedEmailProps {
  tenantName?: string;
  recipientName: string;
  requestReference: string;
  requestUrl?: string;
}

export function RequestApprovedEmail({
  tenantName,
  recipientName,
  requestReference,
  requestUrl,
}: RequestApprovedEmailProps) {
  const ref = requestReference || '—';
  return (
    <NotificationEmail
      tenantName={tenantName}
      recipientName={recipientName}
      title="✅ Transport Request Approved"
      body={`Your transport request ${ref} has been approved. The vehicle allocation and trip preparation process will begin shortly. You will be notified once a vehicle has been assigned.`}
      actionUrl={requestUrl}
    />
  );
}
