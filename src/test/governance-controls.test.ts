import { describe, expect, it } from 'vitest';
import { isPlatformSystemRole, PlatformSystemRoles, SystemRoles } from '@/lib/workspaces';
import { validateWorkflowRouting } from '@/lib/workflow-routing';

const persistedSteps = [
  { id: 'supervisor', stepOrder: 1, actionType: 'supervisor_approve' },
  { id: 'transport', stepOrder: 2, actionType: 'transport_review' },
  { id: 'release', stepOrder: 3, actionType: 'release' },
  { id: 'authorise', stepOrder: 4, actionType: 'authorise' },
  { id: 'driver', stepOrder: 5, actionType: 'acknowledge' },
];

describe('platform role boundary', () => {
  it('classifies every platform-managed role and no tenant role', () => {
    expect(PlatformSystemRoles).toEqual([
      SystemRoles.PLATFORM_ADMIN,
      SystemRoles.PLATFORM_SUPPORT,
      SystemRoles.PLATFORM_AUDITOR,
    ]);
    expect(PlatformSystemRoles.every(isPlatformSystemRole)).toBe(true);
    expect(isPlatformSystemRole(' platform support administrator ')).toBe(true);
    expect(isPlatformSystemRole(SystemRoles.TENANT_ADMIN)).toBe(false);
    expect(isPlatformSystemRole(SystemRoles.TRANSPORT_ADMIN)).toBe(false);
  });
});

describe('workflow routing publication validation', () => {
  it('accepts a complete reordered approval flow with acknowledgement last', () => {
    const result = validateWorkflowRouting(persistedSteps, [
      { id: 'transport', stepOrder: 1, assignedUserId: null },
      { id: 'supervisor', stepOrder: 2, assignedUserId: 'supervisor-user' },
      { id: 'release', stepOrder: 3, assignedUserId: null },
      { id: 'authorise', stepOrder: 4, assignedUserId: null },
      { id: 'driver', stepOrder: 5, assignedUserId: null },
    ]);

    expect(result).toMatchObject({ ok: true, orderChanged: true });
    if (result.ok)
      expect(result.steps.map((step) => step.id)).toEqual([
        'transport',
        'supervisor',
        'release',
        'authorise',
        'driver',
      ]);
  });

  it('rejects moving driver acknowledgement away from the terminal step', () => {
    const result = validateWorkflowRouting(persistedSteps, [
      { id: 'supervisor', stepOrder: 1, assignedUserId: null },
      { id: 'driver', stepOrder: 2, assignedUserId: null },
      { id: 'transport', stepOrder: 3, assignedUserId: null },
      { id: 'release', stepOrder: 4, assignedUserId: null },
      { id: 'authorise', stepOrder: 5, assignedUserId: null },
    ]);

    expect(result).toEqual({
      ok: false,
      error: 'Driver Acknowledgement must remain the final workflow step.',
    });
  });

  it('rejects duplicate, missing, or non-contiguous step submissions', () => {
    expect(
      validateWorkflowRouting(persistedSteps, [
        { id: 'supervisor', stepOrder: 1, assignedUserId: null },
        { id: 'transport', stepOrder: 2, assignedUserId: null },
      ]),
    ).toMatchObject({ ok: false });

    expect(
      validateWorkflowRouting(persistedSteps, [
        { id: 'supervisor', stepOrder: 1, assignedUserId: null },
        { id: 'transport', stepOrder: 2, assignedUserId: null },
        { id: 'release', stepOrder: 4, assignedUserId: null },
        { id: 'authorise', stepOrder: 5, assignedUserId: null },
        { id: 'driver', stepOrder: 6, assignedUserId: null },
      ]),
    ).toMatchObject({ ok: false });
  });
});
