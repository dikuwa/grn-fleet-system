import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { getDb } from '@/db';
import { tenantBranding, tenants } from '@/db/schema/tenants';
import { getSignedFileUrl } from '@/lib/storage';

export interface ResolvedTenantBranding {
  tenantId: string;
  organisationName: string;
  code: string;
  locale: string;
  timezone: string;
  division?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  registrationNumber?: string;
  motto?: string;
  logoUrl?: string;
  /** Render-safe PNG used by React-PDF. Kept separate so snapshot identity cannot replace it. */
  documentLogoUrl?: string;
  sealUrl?: string;
  primaryColor: string;
  accentColor: string;
  documentFooter?: string;
  executiveSignatoryName?: string;
  executiveSignatoryTitle?: string;
  executiveSignatureUrl?: string;
}

export async function resolveTenantBranding(
  tenantId: string,
): Promise<ResolvedTenantBranding | null> {
  const db = getDb();
  const [row] = await db
    .select({
      tenantId: tenants.id,
      organisationName: tenants.name,
      code: tenants.code,
      locale: tenants.locale,
      timezone: tenants.timezone,
      metadata: tenants.metadata,
      logoUrl: tenantBranding.logoUrl,
      primaryColor: tenantBranding.primaryColor,
      accentColor: tenantBranding.accentColor,
      address: tenantBranding.address,
      phone: tenantBranding.contactPhone,
      email: tenantBranding.contactEmail,
      documentFooter: tenantBranding.documentFooter,
      executiveSignatoryName: tenantBranding.executiveSignatoryName,
      executiveSignatoryTitle: tenantBranding.executiveSignatoryTitle,
      executiveSignatureUrl: tenantBranding.executiveSignatureUrl,
    })
    .from(tenants)
    .leftJoin(tenantBranding, eq(tenantBranding.tenantId, tenants.id))
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!row) return null;
  const metadata = row.metadata || {};
  const logoUrl =
    row.logoUrl && !row.logoUrl.startsWith('http') && !row.logoUrl.startsWith('/')
      ? await getSignedFileUrl(row.logoUrl, 3600)
      : row.logoUrl;
  return {
    tenantId: row.tenantId,
    organisationName: row.organisationName,
    code: row.code,
    locale: row.locale,
    timezone: row.timezone,
    division: typeof metadata.division === 'string' ? metadata.division : undefined,
    website: typeof metadata.website === 'string' ? metadata.website : undefined,
    registrationNumber:
      typeof metadata.registrationNumber === 'string' ? metadata.registrationNumber : undefined,
    motto: typeof metadata.motto === 'string' ? metadata.motto : undefined,
    sealUrl: typeof metadata.sealUrl === 'string' ? metadata.sealUrl : undefined,
    logoUrl: logoUrl || undefined,
    primaryColor: row.primaryColor || '#1F2A44',
    accentColor: row.accentColor || '#0F766E',
    address: row.address || undefined,
    phone: row.phone || undefined,
    email: row.email || undefined,
    documentFooter: row.documentFooter || undefined,
    executiveSignatoryName: row.executiveSignatoryName || undefined,
    executiveSignatoryTitle: row.executiveSignatoryTitle || 'Chief Executive Officer',
    executiveSignatureUrl: row.executiveSignatureUrl || undefined,
  };
}

const documentImageCache = new Map<string, { value: string; expiresAt: number }>();

function decodeDataImage(source: string): Buffer | null {
  const match = source.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,([\s\S]+)$/);
  if (!match) return null;
  try {
    return Buffer.from(match[1], 'base64');
  } catch {
    return null;
  }
}

function absoluteDocumentImageUrl(source: string): string {
  if (!source.startsWith('/')) return source;
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL;
  if (!baseUrl) return source;
  const normalizedBase = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`;
  return `${normalizedBase.replace(/\/$/, '')}${source}`;
}

async function readDocumentImage(source?: string): Promise<Buffer | null> {
  if (!source) return null;
  if (source.startsWith('data:')) return decodeDataImage(source);
  const resolvedSource = absoluteDocumentImageUrl(source);
  if (resolvedSource.startsWith('/')) return null;
  try {
    const response = await fetch(resolvedSource, { signal: AbortSignal.timeout(5_000) });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.startsWith('image/')) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.byteLength <= 3_000_000 ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * React-PDF is most reliable with PNG/JPEG. Tenant branding may be uploaded as
 * WebP, so convert every document image to a self-contained PNG before render.
 */
async function embedDocumentImage(source?: string): Promise<string | undefined> {
  if (!source) return undefined;
  const cached = documentImageCache.get(source);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const input = await readDocumentImage(source);
  if (!input) return source;

  try {
    const png = await sharp(input).png().toBuffer();
    const value = `data:image/png;base64,${png.toString('base64')}`;
    documentImageCache.set(source, { value, expiresAt: Date.now() + 5 * 60_000 });
    return value;
  } catch {
    return source;
  }
}

/** Resolve tenant branding with render-safe, self-contained image sources. */
export async function resolveTenantDocumentBranding(
  tenantId: string,
): Promise<ResolvedTenantBranding | null> {
  const branding = await resolveTenantBranding(tenantId);
  if (!branding) return null;
  const documentLogoUrl = await embedDocumentImage(branding.logoUrl);
  return {
    ...branding,
    logoUrl: documentLogoUrl,
    documentLogoUrl,
    sealUrl: await embedDocumentImage(branding.sealUrl),
    executiveSignatureUrl: await embedDocumentImage(branding.executiveSignatureUrl),
  };
}
