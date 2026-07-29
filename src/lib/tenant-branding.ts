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
  };
}
