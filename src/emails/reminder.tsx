import { NotificationEmail } from './notification';
import * as React from 'react';

interface ReminderEmailProps {
  tenantName?: string;
  recipientName: string;
  taskDescription: string;
  entityType: string;
  entityReference: string;
  deadline?: string;
  isEscalation?: boolean;
  actionUrl?: string;
}

export function ReminderEmail({
  tenantName,
  recipientName,
  taskDescription,
  entityType,
  entityReference,
  deadline,
  isEscalation = false,
  actionUrl,
}: ReminderEmailProps) {
  const prefix = isEscalation ? '🔴 ESCALATION' : '⏰ Reminder';
  const urgencyInfo = deadline
    ? isEscalation
      ? `This task was due by ${deadline} and requires immediate attention.`
      : `Please complete this before ${deadline}.`
    : '';

  return (
    <NotificationEmail
      tenantName={tenantName}
      recipientName={recipientName}
      title={`${prefix}: ${taskDescription}`}
      body={`${entityType} ${entityReference} requires your attention. ${taskDescription}. ${urgencyInfo}`}
      actionUrl={actionUrl}
      isEmergency={isEscalation}
    />
  );
}
