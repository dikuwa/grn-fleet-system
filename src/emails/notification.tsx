import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';

interface NotificationEmailProps {
  tenantName?: string;
  recipientName: string;
  title: string;
  body: string;
  actionUrl?: string;
  isEmergency?: boolean;
}

export function NotificationEmail({
  tenantName = 'GovFleet Namibia',
  recipientName,
  title,
  body,
  actionUrl,
  isEmergency = false,
}: NotificationEmailProps) {
  const accentColor = isEmergency ? '#dc2626' : '#1F4E8C';

  return (
    <Html>
      <Head />
      <Preview>{title}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={headerSection}>
            <Heading style={{ ...h1, color: accentColor }}>{tenantName}</Heading>
            <Hr
              style={{
                ...hr,
                borderColor: accentColor,
                width: 48,
                margin: '12px auto',
              }}
            />
          </Section>

          {/* Body */}
          <Section style={bodySection}>
            <Text style={greeting}>Hi {recipientName},</Text>
            <Heading as="h2" style={h2}>
              {title}
            </Heading>
            <Text style={paragraph}>{body}</Text>
          </Section>

          {/* CTA Button */}
          {actionUrl && (
            <Section style={ctaSection}>
              <Link href={actionUrl} style={{ ...button, backgroundColor: accentColor }}>
                View Details
              </Link>
            </Section>
          )}

          {/* Footer */}
          <Section style={footerSection}>
            <Text style={footerText}>
              This is an automated notification from the Government Fleet Management System.
              Please do not reply to this email.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// Styles
const main = {
  margin: 0,
  padding: 0,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  backgroundColor: '#f4f4f5',
};

const container = {
  margin: '32px auto',
  padding: 0,
  width: '100%',
  maxWidth: 560,
};

const headerSection = {
  padding: '32px 32px 0',
  textAlign: 'center' as const,
  backgroundColor: '#ffffff',
  borderRadius: '12px 12px 0 0',
};

const h1 = {
  margin: 0,
  fontSize: 16,
  fontWeight: 700,
  letterSpacing: 0.5,
  textTransform: 'uppercase' as const,
};

const hr = {
  border: 'none',
  borderTop: '2px solid',
};

const bodySection = {
  padding: '16px 32px 8px',
  backgroundColor: '#ffffff',
};

const greeting = {
  margin: '0 0 8px',
  fontSize: 14,
  color: '#52525b',
};

const h2 = {
  margin: '0 0 8px',
  fontSize: 18,
  fontWeight: 600,
  color: '#18181b',
};

const paragraph = {
  margin: '0 0 16px',
  fontSize: 14,
  lineHeight: 1.6,
  color: '#52525b',
};

const ctaSection = {
  padding: '0 32px 24px',
  backgroundColor: '#ffffff',
};

const button = {
  display: 'inline-block',
  padding: '10px 24px',
  borderRadius: 8,
  color: '#ffffff',
  fontSize: 14,
  fontWeight: 500,
  textDecoration: 'none',
};

const footerSection = {
  padding: '24px 32px',
  backgroundColor: '#f4f4f5',
  borderRadius: '0 0 12px 12px',
};

const footerText = {
  margin: 0,
  fontSize: 12,
  color: '#a1a1aa',
};
