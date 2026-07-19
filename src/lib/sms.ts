/**
 * SMS Notification Service
 *
 * Sends transactional SMS messages via configurable provider.
 * Supports Twilio and Vonage (Nexmo) out of the box.
 * Falls back gracefully when no provider is configured.
 *
 * Enable by setting ENABLE_SMS=true and SMS_PROVIDER=twilio|vonage
 * in your environment, along with the provider's API credentials.
 *
 * To use a provider, install its SDK:
 *   pnpm add twilio              # for SMS_PROVIDER=twilio
 *   pnpm add @vonage/server-sdk  # for SMS_PROVIDER=vonage
 */

import { env } from '@/env';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SmsData {
  to: string;
  message: string;
  type?: string;
}

interface SmsResult {
  success: boolean;
  id?: string;
  error?: string;
}

interface SmsProvider {
  name: string;
  send: (data: SmsData) => Promise<SmsResult>;
}

// ---------------------------------------------------------------------------
// Dynamic imports — only loaded when the provider is actually used
// ---------------------------------------------------------------------------

type TwilioClient = {
  messages: {
    create: (opts: { body: string; from: string; to: string }) => Promise<{ sid: string }>;
  };
};

type VonageClient = {
  sms: {
    send: (opts: { from: string; to: string; text: string }) => Promise<{
      messages: Array<{ 'message-id': string; status: string }>;
    }>;
  };
};

let twilioClient: TwilioClient | null = null;

async function getTwilioClient(): Promise<TwilioClient | null> {
  if (twilioClient) return twilioClient;
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) return null;

  try {
    const twilio = await import('twilio');
    const factory = (twilio.default || twilio) as unknown as (sid: string, token: string) => TwilioClient;
    twilioClient = factory(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    return twilioClient;
  } catch {
    console.warn('[SMS] Twilio SDK not installed. Run: pnpm add twilio');
    return null;
  }
}

let vonageClient: VonageClient | null = null;

async function getVonageClient(): Promise<VonageClient | null> {
  if (vonageClient) return vonageClient;
  if (!env.VONAGE_API_KEY || !env.VONAGE_API_SECRET) return null;

  try {
    const { Vonage } = await import('@vonage/server-sdk');
    vonageClient = new Vonage({
      apiKey: env.VONAGE_API_KEY,
      apiSecret: env.VONAGE_API_SECRET,
    }) as unknown as VonageClient;
    return vonageClient;
  } catch {
    console.warn('[SMS] Vonage SDK not installed. Run: pnpm add @vonage/server-sdk');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

const twilioProvider: SmsProvider = {
  name: 'twilio',
  send: async (data) => {
    const client = await getTwilioClient();
    if (!client) {
      return { success: false, error: 'Twilio not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.' };
    }

    const from = env.TWILIO_PHONE_NUMBER;
    if (!from) {
      return { success: false, error: 'Twilio phone number not configured. Set TWILIO_PHONE_NUMBER.' };
    }

    try {
      const result = await client.messages.create({
        body: data.message,
        from,
        to: data.to,
      });
      return { success: true, id: result.sid };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SMS:Twilio] Send failed:', message);
      return { success: false, error: message };
    }
  },
};

const vonageProvider: SmsProvider = {
  name: 'vonage',
  send: async (data) => {
    const client = await getVonageClient();
    if (!client) {
      return { success: false, error: 'Vonage not configured. Set VONAGE_API_KEY and VONAGE_API_SECRET.' };
    }

    const from = env.VONAGE_FROM_NUMBER || 'GovFleet';

    try {
      const result = await client.sms.send({ from, to: data.to, text: data.message });
      const msg = result.messages?.[0];
      if (msg?.status === '0') {
        return { success: true, id: msg['message-id'] };
      }
      return { success: false, error: `Vonage returned status ${msg?.status}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SMS:Vonage] Send failed:', message);
      return { success: false, error: message };
    }
  },
};

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

const PROVIDERS: Record<string, SmsProvider> = {
  twilio: twilioProvider,
  vonage: vonageProvider,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function getProvider(): SmsProvider | null {
  if (env.ENABLE_SMS !== 'true') return null;

  const providerName = env.SMS_PROVIDER || 'disabled';
  if (providerName === 'disabled' || !providerName) return null;

  const provider = PROVIDERS[providerName];
  if (!provider) {
    console.warn(`[SMS] Unknown SMS_PROVIDER: "${providerName}". Supported: ${Object.keys(PROVIDERS).join(', ')}`);
    return null;
  }

  return provider;
}

/**
 * Send an SMS message via the configured provider.
 */
export async function sendSms(data: SmsData): Promise<SmsResult> {
  const provider = getProvider();
  if (!provider) {
    const error = 'SMS service not configured. Set ENABLE_SMS=true, SMS_PROVIDER, and provider credentials.';
    return { success: false, error };
  }

  return provider.send(data);
}

/**
 * Send a notification-style SMS with consistent formatting.
 */
export async function sendNotificationSms(
  to: string,
  title: string,
  body: string,
  tenantName?: string,
): Promise<SmsResult> {
  const prefix = tenantName ? `[${tenantName}] ` : '[GovFleet] ';
  const message = `${prefix}${title}\n\n${body}`;
  return sendSms({ to, message, type: 'notification' });
}

/**
 * Check if SMS is enabled and configured.
 */
export function isSmsEnabled(): boolean {
  return getProvider() !== null;
}
