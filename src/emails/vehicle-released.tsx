import { NotificationEmail } from './notification';
import * as React from 'react';

interface VehicleReleasedEmailProps {
  tenantName?: string;
  recipientName: string;
  requestReference: string;
  vehicleName?: string;
  licenceNumber?: string;
  requestUrl?: string;
}

export function VehicleReleasedEmail({
  tenantName,
  recipientName,
  requestReference,
  vehicleName,
  licenceNumber,
  requestUrl,
}: VehicleReleasedEmailProps) {
  const vehicleInfo = [vehicleName, licenceNumber].filter(Boolean).join(' · ');
  const body = vehicleInfo
    ? `Vehicle ${vehicleInfo} has been released for trip ${requestReference}. Please proceed with the pre-trip inspection and driver acknowledgement.`
    : `A vehicle has been released for trip ${requestReference}. Please proceed with the pre-trip inspection and driver acknowledgement.`;

  return (
    <NotificationEmail
      tenantName={tenantName}
      recipientName={recipientName}
      title="🚗 Vehicle Released"
      body={body}
      actionUrl={requestUrl}
    />
  );
}
