import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('tenant admin file inventory operational evidence scope', () => {
  it('reuses the generic file-access policy for explicit operational categories', () => {
    const route = source('src/app/api/upload/route.ts');

    expect(route).toContain("import { canTenantAdminUseGenericFileKey } from '@/lib/file-access-policy';");
    expect(route).toContain('workspace.activeWorkspace === WorkspaceIds.TENANT_ADMIN');
    expect(route).toContain('!canTenantAdminUseGenericFileKey(`${CATEGORY_PATHS[category as UploadCategory]}/`)');
    expect(route).toContain('Transport Operations evidence is not available in Tenant Administration.');
  });

  it('filters operational object keys from an unfiltered tenant inventory', () => {
    const route = source('src/app/api/upload/route.ts');

    expect(route).toContain('const tenantPrefix = `tenant/${session.tenantId}/`;');
    expect(route).toContain('const visibleFiles =');
    expect(route).toContain('files.filter((file) => canTenantAdminUseGenericFileKey(file.key.slice(tenantPrefix.length)))');
    expect(route).toContain('data: visibleFiles');
  });
});
