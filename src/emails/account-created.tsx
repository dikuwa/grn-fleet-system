import { NotificationEmail } from './notification';
import * as React from 'react';

interface AccountCreatedEmailProps {
  tenantName?: string;
  recipientName: string;
  loginUrl?: string;
}

export function AccountCreatedEmail({
  tenantName,
  recipientName,
  loginUrl,
}: AccountCreatedEmailProps) {
  return (
    <NotificationEmail
      tenantName={tenantName}
      recipientName={recipientName}
      title="🎉 Account Created"
      body="Your account has been created on the Government Fleet Management System. You can now log in to submit transport requests, view allocations, and manage trips."
      actionUrl={loginUrl}
    />
  );
}
