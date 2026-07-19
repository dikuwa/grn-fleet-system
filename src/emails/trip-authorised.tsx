import { NotificationEmail } from './notification';
import * as React from 'react';

interface TripAuthorisedEmailProps {
  tenantName?: string;
  recipientName: string;
  requestReference: string;
  tripDates?: string;
  requestUrl?: string;
}

export function TripAuthorisedEmail({
  tenantName,
  recipientName,
  requestReference,
  tripDates,
  requestUrl,
}: TripAuthorisedEmailProps) {
  const body = tripDates
    ? `Your trip ${requestReference} has been fully authorised for ${tripDates}. The assigned driver should proceed with the journey.`
    : `Your trip ${requestReference} has been fully authorised. The assigned driver should proceed with the journey.`;

  return (
    <NotificationEmail
      tenantName={tenantName}
      recipientName={recipientName}
      title="📋 Trip Authorised"
      body={body}
      actionUrl={requestUrl}
    />
  );
}
