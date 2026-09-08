import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const route = readFileSync(
  resolve(process.cwd(), 'src/app/api/notifications/route.ts'),
  'utf8',
);

const postIndex = route.indexOf('export async function POST');
const deleteIndex = route.indexOf('export async function DELETE');
const postRoute = route.slice(postIndex, deleteIndex);

describe('notification outbound content trust boundary', () => {
  it('does not trust request-body tenant branding for outbound delivery', () => {
    expect(postIndex).toBeGreaterThan(-1);
    expect(postRoute).not.toContain('      tenantName,\n');
    expect(postRoute).toContain(".select({ name: tenants.name })");
    expect(postRoute).toContain('.where(eq(tenants.id, tenantId))');
    expect(postRoute).toContain('senderName: tenantBranding.senderName');
    expect(postRoute).toContain('.where(eq(tenantBranding.tenantId, tenantId))');
    expect(postRoute).toContain(
      "brandingRecord?.senderName?.trim() || tenantRecord.name.trim() || 'GovFleet Namibia'",
    );
    expect(postRoute).toContain('tenantName: resolvedTenantName');
    expect(postRoute).toContain('resolvedTenantName,\n      );');
  });

  it('normalizes notification actions to the application dashboard boundary', () => {
    expect(route).toContain('function normalizeNotificationActionUrl(value: unknown)');
    expect(route).toContain("if (trimmed.startsWith('//')) return null;");
    expect(route).toContain('if (candidate.origin !== appBase.origin) return null;');
    expect(route).toContain(
      "candidate.pathname !== '/dashboard' && !candidate.pathname.startsWith('/dashboard/')",
    );
    expect(postRoute).toContain('const actionTarget = normalizeNotificationActionUrl(actionUrl);');
    expect(postRoute).toContain("{ error: 'Notification action URL must point to this application dashboard' }");
  });

  it('stores only the normalized dashboard path and sends only the normalized delivery URL', () => {
    expect(postRoute).toContain('actionUrl: actionTarget.stored');
    expect(postRoute).toContain('actionUrl: actionTarget.delivery');
    expect(postRoute).not.toContain('        actionUrl,\n');
  });

  it('keeps absent action URLs valid without inventing an external destination', () => {
    expect(route).toContain("return { stored: null, delivery: undefined };");
  });
});
