/**
 * Accept Invitation API
 *
 * GET  /api/auth/accept-invite?token=xxx — Validate invitation token and return details
 * POST /api/auth/accept-invite — Accept invitation, create user + membership
 */

import { NextRequest, NextResponse } from 'next/server';
import { findInvitationByToken, acceptInvitation } from '@/lib/platform/invitations';

// ---------------------------------------------------------------------------
// GET — Validate invitation token
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token');
    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 });
    }

    const invitation = await findInvitationByToken(token);
    if (!invitation) {
      return NextResponse.json({ error: 'Invalid or expired invitation' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: {
        id: invitation.id,
        email: invitation.email,
        name: invitation.name,
        tenantId: invitation.tenantId,
        tenantName: invitation.tenantName,
        expiresAt: invitation.expiresAt,
        type: invitation.type,
      },
    });
  } catch (error) {
    console.error('[AcceptInvite GET] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — Accept invitation
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, name, email, password } = body;

    if (!token || !email || !password) {
      return NextResponse.json(
        { error: 'Token, email, and password are required' },
        { status: 400 },
      );
    }

    const result = await acceptInvitation({
      rawToken: token,
      name: name || '',
      email,
      password,
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[AcceptInvite POST] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}