import { eq } from 'drizzle-orm';
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

async function embedDocumentImage(source?: string): Promise<string | undefined> {
  if (!source || source.startsWith('data:')) return source;
  const cached = documentImageCache.get(source);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const response = await fetch(source, { signal: AbortSignal.timeout(5_000) });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.startsWith('image/')) return source;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 3_000_000) return source;
    const value = `data:${contentType.split(';')[0]};base64,${Buffer.from(bytes).toString('base64')}`;
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
  return {
    ...branding,
    logoUrl: await embedDocumentImage(branding.logoUrl),
    sealUrl: await embedDocumentImage(branding.sealUrl),
    executiveSignatureUrl: await embedDocumentImage(branding.executiveSignatureUrl),
  };
}
