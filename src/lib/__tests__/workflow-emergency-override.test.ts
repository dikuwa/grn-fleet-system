import { NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth-helpers', () => ({
  requirePermission: vi.fn(async () =>
    NextResponse.json({ error: 'You do not have permission to perform this action' }, { status: 403 }),
  ),
  forbiddenResponse: vi.fn((message = 'Forbidden') =>
    NextResponse.json({ error: message }, { status: 403 }),
  ),
}));

import { WorkflowEngine } from '@/lib/workflow-engine';

describe('WorkflowEngine.processEmergencyOverride', () => {
  it('fails closed before touching workflow state', async () => {
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
