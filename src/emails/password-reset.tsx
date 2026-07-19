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

interface PasswordResetEmailProps {
  tenantName?: string;
  recipientName: string;
  resetUrl: string;
}

export function PasswordResetEmail({
  tenantName = 'GovFleet Namibia',
  recipientName,
  resetUrl,
}: PasswordResetEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Reset your GovFleet password</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={headerSection}>
            <Heading style={h1}>{tenantName}</Heading>
            <Hr style={hr} />
          </Section>

          <Section style={bodySection}>
            <Text style={greeting}>Hi {recipientName},</Text>
            <Heading as="h2" style={h2}>
              Password Reset Request
            </Heading>
            <Text style={paragraph}>
              We received a request to reset your password. Click the button below to set a new
              password. This link expires in 1 hour.
            </Text>
          </Section>

          <Section style={ctaSection}>
            <Link href={resetUrl} style={button}>
              Reset Password
            </Link>
          </Section>

          <Section style={bodySection}>
            <Text style={paragraph}>
              If you did not request this, you can safely ignore this email. Your password will
              remain unchanged.
            </Text>
          </Section>

          <Section style={footerSection}>
            <Text style={footerText}>
              This is an automated message from the {tenantName} Fleet Management System.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

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
  color: '#1F4E8C',
  letterSpacing: 0.5,
  textTransform: 'uppercase' as const,
};

const hr = {
  border: 'none',
  borderTop: '2px solid #1F4E8C',
  margin: '12px auto',
  width: 48,
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
  backgroundColor: '#1F4E8C',
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
