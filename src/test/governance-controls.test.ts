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

const GOVERNED_ORDER_ERROR =
  'Approval gates must remain in the governed transport lifecycle order. Change assignees or optional stages instead of reordering system stages.';

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
  it('accepts assignment changes while preserving the governed transport lifecycle order', () => {
    const result = validateWorkflowRouting(persistedSteps, [
      { id: 'supervisor', stepOrder: 1, assignedUserId: 'supervisor-user' },
      { id: 'transport', stepOrder: 2, assignedUserId: null },
      { id: 'release', stepOrder: 3, assignedUserId: 'release-user' },
      { id: 'authorise', stepOrder: 4, assignedUserId: null },
      { id: 'driver', stepOrder: 5, assignedUserId: null },
    ]);

    expect(result).toMatchObject({ ok: true, orderChanged: false });
    if (result.ok) {
      expect(result.steps.map((step) => step.id)).toEqual([
        'supervisor',
        'transport',
        'release',
        'authorise',
        'driver',
      ]);
      expect(result.steps[0]?.assignedUserId).toBe('supervisor-user');
      expect(result.steps[2]?.assignedUserId).toBe('release-user');
    }
  });

  it('rejects reordering governed operational lifecycle stages', () => {
    const result = validateWorkflowRouting(persistedSteps, [
      { id: 'transport', stepOrder: 1, assignedUserId: null },
      { id: 'supervisor', stepOrder: 2, assignedUserId: 'supervisor-user' },
      { id: 'release', stepOrder: 3, assignedUserId: null },
      { id: 'authorise', stepOrder: 4, assignedUserId: null },
      { id: 'driver', stepOrder: 5, assignedUserId: null },
    ]);

    expect(result).toEqual({ ok: false, error: GOVERNED_ORDER_ERROR });
  });

  it('rejects moving driver acknowledgement into the middle of the governed lifecycle', () => {
    const result = validateWorkflowRouting(persistedSteps, [
      { id: 'supervisor', stepOrder: 1, assignedUserId: null },
      { id: 'driver', stepOrder: 2, assignedUserId: null },
      { id: 'transport', stepOrder: 3, assignedUserId: null },
      { id: 'release', stepOrder: 4, assignedUserId: null },
      { id: 'authorise', stepOrder: 5, assignedUserId: null },
    ]);

    expect(result).toEqual({ ok: false, error: GOVERNED_ORDER_ERROR });
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
