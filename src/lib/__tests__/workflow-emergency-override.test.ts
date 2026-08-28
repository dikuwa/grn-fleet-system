import { NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth-helpers', () => ({
  // Deliberately allow the retired permission. The emergency-override method
  // must remain fail-closed even if permission plumbing is later refactored or
  // accidentally made permissive.
  requirePermission: vi.fn(async () => true),
  forbiddenResponse: vi.fn((message = 'Forbidden') =>
    NextResponse.json({ error: message }, { status: 403 }),
  ),
}));

import { WorkflowEngine } from '@/lib/workflow-engine';

describe('WorkflowEngine.processEmergencyOverride', () => {
  it('fails closed before touching workflow state even when authorization is permissive', async () => {
    let databaseTouched = false;
    const db = new Proxy(
      {},
      {
        get() {
          databaseTouched = true;
          throw new Error('database must not be touched by retired emergency override');
        },
      },
    );

    const engine = new WorkflowEngine({ db: db as never });
    const session = {
      user: {
        id: 'user-1',
        email: 'approver@example.com',
        name: 'Approver',
        image: undefined,
      },
      tenantId: 'tenant-1',
      tenantSlug: 'tenant',
    };

    const result = await engine.processEmergencyOverride(
      'workflow-1',
      'Emergency request',
      undefined,
      session,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.status).toBe(403);
    expect(databaseTouched).toBe(false);
  });
});
