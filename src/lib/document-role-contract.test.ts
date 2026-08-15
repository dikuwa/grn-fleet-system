import { describe, expect, it } from 'vitest';
import { resolveDashboardAccess, SystemRoles } from '@/lib/dashboard-access';
import { WorkspaceIds } from '@/lib/workspaces';

describe('document and share-link role contracts', () => {
  it('keeps Transport Administration as the document lifecycle and distribution manager', () => {
    const documents = resolveDashboardAccess(
      '/dashboard/documents',
      [SystemRoles.TRANSPORT_ADMIN],
      WorkspaceIds.TRANSPORT_ADMIN,
    );
    const shares = resolveDashboardAccess(
      '/dashboard/share-links',
      [SystemRoles.TRANSPORT_ADMIN],
      WorkspaceIds.TRANSPORT_ADMIN,
    );

    expect(documents.allowed).toBe(true);
    expect(documents.recordScope).toBe('tenant');
    expect(documents.actions).toEqual(
      expect.arrayContaining(['view', 'create', 'update', 'delete', 'export']),
    );
    expect(shares.allowed).toBe(true);
    expect(shares.actions).toEqual(
      expect.arrayContaining(['view', 'create', 'delete']),
    );
  });

  it('keeps Tenant Auditor tenant-wide but strictly read-only for documents and share links', () => {
    const documents = resolveDashboardAccess(
      '/dashboard/documents',
      [SystemRoles.AUDITOR],
      WorkspaceIds.AUDIT,
    );
    const shares = resolveDashboardAccess(
      '/dashboard/share-links',
      [SystemRoles.AUDITOR],
      WorkspaceIds.AUDIT,
    );

    expect(documents.allowed).toBe(true);
    expect(documents.recordScope).toBe('tenant');
    expect(documents.actions).toEqual(['view', 'export']);
    expect(documents.actions).not.toContain('update');
    expect(shares.allowed).toBe(true);
    expect(shares.actions).toEqual(['view', 'export']);
    expect(shares.actions).not.toContain('create');
    expect(shares.actions).not.toContain('delete');
  });

  it('keeps reimbursements operationally restricted to Transport Administration', () => {
    const transport = resolveDashboardAccess(
      '/dashboard/reimbursements',
      [SystemRoles.TRANSPORT_ADMIN],
      WorkspaceIds.TRANSPORT_ADMIN,
    );
    const auditor = resolveDashboardAccess(
      '/dashboard/reimbursements',
      [SystemRoles.AUDITOR],
      WorkspaceIds.AUDIT,
    );
    const driver = resolveDashboardAccess(
      '/dashboard/reimbursements',
      [SystemRoles.DRIVER],
      WorkspaceIds.DRIVER,
    );

    expect(transport.allowed).toBe(true);
    expect(transport.recordScope).toBe('tenant');
    expect(transport.actions).toEqual(expect.arrayContaining(['view', 'create', 'update']));
    expect(auditor.allowed).toBe(false);
    expect(auditor.actions).toEqual([]);
    expect(driver.allowed).toBe(false);
    expect(driver.actions).toEqual([]);
  });

  it('keeps closure review tenant-wide and Transport Administration-only', () => {
    const transport = resolveDashboardAccess(
      '/dashboard/trips/closure-review',
      [SystemRoles.TRANSPORT_ADMIN],
      WorkspaceIds.TRANSPORT_ADMIN,
    );
    const auditor = resolveDashboardAccess(
      '/dashboard/trips/closure-review',
      [SystemRoles.AUDITOR],
      WorkspaceIds.AUDIT,
    );
    const driver = resolveDashboardAccess(
      '/dashboard/trips/closure-review',
      [SystemRoles.DRIVER],
      WorkspaceIds.DRIVER,
    );

    expect(transport.allowed).toBe(true);
    expect(transport.recordScope).toBe('tenant');
    expect(transport.actions).toEqual(expect.arrayContaining(['view', 'approve', 'update']));
    expect(auditor.allowed).toBe(false);
    expect(auditor.actions).toEqual([]);
    expect(driver.allowed).toBe(false);
    expect(driver.actions).toEqual([]);
  });

  it('keeps Driver document access assigned-only and denies the share-link register', () => {
    const documents = resolveDashboardAccess(
      '/dashboard/documents',
      [SystemRoles.DRIVER],
      WorkspaceIds.DRIVER,
    );
    const shares = resolveDashboardAccess(
      '/dashboard/share-links',
      [SystemRoles.DRIVER],
      WorkspaceIds.DRIVER,
    );

    expect(documents.allowed).toBe(true);
    expect(documents.recordScope).toBe('assigned');
    expect(documents.actions).toEqual(['view']);
    expect(shares.allowed).toBe(false);
    expect(shares.actions).toEqual([]);
  });

  it('does not let Driver open official inspection creation routes', () => {
    const inspectionCreate = resolveDashboardAccess(
      '/dashboard/inspections/new',
      [SystemRoles.DRIVER],
      WorkspaceIds.DRIVER,
    );
    const inspectionRegister = resolveDashboardAccess(
      '/dashboard/inspections',
      [SystemRoles.DRIVER],
      WorkspaceIds.DRIVER,
    );

    expect(inspectionCreate.allowed).toBe(false);
    expect(inspectionRegister.allowed).toBe(true);
    expect(inspectionRegister.recordScope).toBe('assigned');
    expect(inspectionRegister.actions).toEqual(['view']);
  });
});
