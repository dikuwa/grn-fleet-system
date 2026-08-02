import { NextRequest, NextResponse } from 'next/server';
import { getSessionWorkspace, requireRequestAuth, setSessionWorkspace } from '@/lib/auth-helpers';
import { isWorkspaceId } from '@/lib/workspaces';

export async function GET(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const context = await getSessionWorkspace(auth.session);
  return NextResponse.json({
    success: true,
    data: {
      activeWorkspace: context.activeWorkspace,
      eligibleWorkspaces: context.eligibleWorkspaces.map(({ id, label }) => ({ id, label })),
    },
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const body = await request.json().catch(() => null);
  if (!isWorkspaceId(body?.workspace)) {
    return NextResponse.json({ error: 'Invalid workspace' }, { status: 400 });
  }
  const updated = await setSessionWorkspace(auth.session, body.workspace);
  if (!updated) {
    return NextResponse.json(
      { error: 'Workspace is not available for this user' },
      { status: 403 },
    );
  }
  return NextResponse.json({ success: true, data: { activeWorkspace: body.workspace } });
}
