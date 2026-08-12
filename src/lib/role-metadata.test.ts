import { describe, expect, it } from 'vitest';
import {
  PLATFORM_ROLE_PERMISSIONS,
  PLATFORM_ROLE_RESPONSIBILITIES,
  PLATFORM_SYSTEM_ROLE_NAMES,
  PROTECTED_ROLE_EDIT_PHRASE,
  SYSTEM_ROLE_REQUIRED_PERMISSIONS,
  SYSTEM_ROLE_RESPONSIBILITIES,
  TENANT_SYSTEM_ROLE_NAMES,
  isTenantSystemRole,
  permissionLabel,
  roleResponsibility,
  summarizeCurrentAccess,
} from '@/lib/role-metadata';
import {
  Permissions,
  RoleDefinitions,
  isPermissionAvailableInWorkspace,
  type PermissionCode,
} from '@/lib/permissions';
import { PlatformSystemRoles, SystemRoles, WorkspaceIds } from '@/lib/workspaces';

describe('summarizeCurrentAccess', () => {
  it('returns no areas for an empty permission set', () => {
    expect(summarizeCurrentAccess([])).toEqual([]);
  });

  it('maps persisted permission codes to short human-readable areas', () => {
    expect(summarizeCurrentAccess([Permissions.REQUEST_CREATE, Permissions.VEHICLE_VIEW])).toEqual([
      'Requests',
      'Vehicles',
    ]);
  });

  it('never silently drops grants outside the main groups', () => {
    expect(summarizeCurrentAccess([Permissions.EMERGENCY_CONTACTS_MANAGE])).toEqual([
      'Emergency contacts',
    ]);
  });

  it('labels platform permissions as a single Platform area', () => {
    expect(summarizeCurrentAccess([Permissions.TENANT_MANAGE])).toEqual(['Platform']);
  });

  it('deduplicates overlapping group grants', () => {
    expect(summarizeCurrentAccess([Permissions.REQUEST_CREATE, Permissions.REQUEST_VIEW])).toEqual([
      'Requests',
    ]);
  });
});

describe('roleResponsibility', () => {
  it('uses the predefined responsibility for tenant system roles', () => {
    expect(roleResponsibility(SystemRoles.TRANSPORT_ADMIN, null)).toBe(
      SYSTEM_ROLE_RESPONSIBILITIES[SystemRoles.TRANSPORT_ADMIN],
    );
    expect(roleResponsibility(SystemRoles.TRANSPORT_ADMIN, 'ignored description')).toContain(
      'transport requests',
    );
  });

  it('uses the predefined responsibility for platform system roles', () => {
    expect(roleResponsibility(SystemRoles.PLATFORM_AUDITOR, null)).toBe(
      PLATFORM_ROLE_RESPONSIBILITIES[SystemRoles.PLATFORM_AUDITOR],
    );
  });

  it('falls back to the stored description for custom roles', () => {
    expect(
      roleResponsibility('Fleet Reviewer', '  Captures vehicle records and fuel data.  '),
    ).toBe('Captures vehicle records and fuel data.');
  });

  it('provides a neutral fallback for custom roles without a description', () => {
    expect(roleResponsibility('Fleet Reviewer', null)).toBe('Tenant custom role.');
  });
});

describe('tenant system role baselines', () => {
  it('keeps tenant and platform role sets disjoint', () => {
    for (const name of TENANT_SYSTEM_ROLE_NAMES) {
      expect(PlatformSystemRoles).not.toContain(name);
    }
  });

  it('defines a non-empty required baseline for every tenant system role', () => {
    expect(TENANT_SYSTEM_ROLE_NAMES.length).toBeGreaterThan(0);
    for (const name of TENANT_SYSTEM_ROLE_NAMES) {
      const baseline = SYSTEM_ROLE_REQUIRED_PERMISSIONS[name] ?? [];
      expect(baseline.length, name).toBeGreaterThan(0);
    }
  });

  it('only references real permission codes', () => {
    const valid = new Set<string>(Object.values(Permissions));
    for (const name of TENANT_SYSTEM_ROLE_NAMES) {
      for (const code of SYSTEM_ROLE_REQUIRED_PERMISSIONS[name] ?? []) {
        expect(valid.has(code), `${name} -> ${code}`).toBe(true);
      }
    }
  });
});

describe('platform role baselines', () => {
  it('covers exactly the three platform system roles', () => {
    expect([...PLATFORM_SYSTEM_ROLE_NAMES].sort()).toEqual([...PlatformSystemRoles].sort());
    expect(Object.keys(PLATFORM_ROLE_PERMISSIONS).sort()).toEqual([...PlatformSystemRoles].sort());
  });

  it('defines a non-empty baseline for every platform role', () => {
    for (const name of PlatformSystemRoles) {
      expect((PLATFORM_ROLE_PERMISSIONS[name] ?? []).length, name).toBeGreaterThan(0);
    }
  });

  it('only grants permissions that are valid in the platform workspace', () => {
    for (const name of PlatformSystemRoles) {
      for (const code of PLATFORM_ROLE_PERMISSIONS[name] ?? []) {
        expect(
          isPermissionAvailableInWorkspace(code as PermissionCode, WorkspaceIds.PLATFORM_ADMIN),
          `${name} -> ${code}`,
        ).toBe(true);
      }
    }
  });

  it('never falls through to the custom-role placeholder', () => {
    for (const name of PlatformSystemRoles) {
      expect(roleResponsibility(name, null)).not.toBe('Tenant custom role.');
    }
  });

  it('derives from the canonical RoleDefinitions platform baselines', () => {
    for (const name of PlatformSystemRoles) {
      const definition = Object.values(RoleDefinitions).find((role) => role.name === name);
      expect(definition, name).toBeDefined();
      expect(PLATFORM_ROLE_PERMISSIONS[name]).toEqual(definition?.permissions);
    }
  });
});

describe('permissionLabel', () => {
  it('maps known codes to readable labels', () => {
    expect(permissionLabel(Permissions.REQUEST_REVIEW_TRANSPORT)).toBe('Review transport requests');
    expect(permissionLabel(Permissions.PLATFORM_ADMIN)).toBe('Platform administration');
  });

  it('derives a readable label from an unknown code', () => {
    expect(permissionLabel('unknown:some-key')).toBe('Some Key');
  });
});

describe('isTenantSystemRole', () => {
  it('recognises tenant built-in roles', () => {
    expect(isTenantSystemRole(SystemRoles.TRANSPORT_ADMIN)).toBe(true);
  });

  it('excludes platform roles and custom roles', () => {
    expect(isTenantSystemRole(SystemRoles.PLATFORM_ADMIN)).toBe(false);
    expect(isTenantSystemRole('Fleet Reviewer')).toBe(false);
  });
});

describe('protected edit phrase', () => {
  it('is the exact phrase the unlock dialog requires', () => {
    expect(PROTECTED_ROLE_EDIT_PHRASE).toBe('EDIT ROLE');
  });
});
