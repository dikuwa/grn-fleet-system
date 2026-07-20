import { NotificationEmail } from './notification';
import * as React from 'react';

interface UserInviteEmailProps {
  tenantName?: string;
  recipientName: string;
  recipientEmail: string;
  tempPassword: string;
  loginUrl: string;
  invitedByName: string;
}

export function UserInviteEmail({
  tenantName,
  recipientName,
  recipientEmail,
  tempPassword,
  loginUrl,
  invitedByName,
}: UserInviteEmailProps) {
  return (
    <NotificationEmail
      tenantName={tenantName}
      recipientName={recipientName}
      title="🎉 Your Account Has Been Created"
      body={`${invitedByName} has invited you to join ${tenantName || 'GovFleet Namibia'} — the Government Fleet Management System.

Your account has been created with the email address ${recipientEmail}.

Your temporary password is: ${tempPassword}

For security reasons, please log in and change your password immediately.`}
      actionUrl={loginUrl}
    />
  );
}
