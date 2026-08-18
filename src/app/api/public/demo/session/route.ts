import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { session, user } from '@/db/schema/better-auth';
import { demoSandboxes } from '@/db/schema/demo-requests';
import { tenantMemberships } from '@/db/schema/tenants';
import { and, eq, sql } from 'drizzle-orm';
import { rateLimit } from '@/lib/rate-limit';
import {
  getPublishedLiveDemo,
  isLiveDemoPersona,
  LIVE_DEMO_PERSONAS,
  readLiveDemoPersonaUserId,
} from '@/lib/public-demo';

const MAX_PUBLIC_DEMO_SESSION_MS = 2 * 60 * 60_000;

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const limited = await rateLimit(`public-live-demo:${ip}`, 20, 600);
    if (!limited.success) {
      return NextResponse.json(
        { error: 'Too many demo sessions were started. Please try again shortly.' },
        { status: 429, headers: limited.headers },
      );
    }

    const body = await request.json().catch(() => null);
    const persona = body?.persona;
    if (!isLiveDemoPersona(persona)) {
      return NextResponse.json({ error: 'Choose a valid demo role.' }, { status: 400 });
    }

    const published = await getPublishedLiveDemo();
    if (!published) {
      return NextResponse.json(
        { error: 'The live demo is temporarily unavailable. Please request a private demo.' },
        { status: 503 },
      );
    }

    const userId = readLiveDemoPersonaUserId(published.metadata, persona);
    if (!userId) {
      return NextResponse.json({ error: 'This demo role is not ready.' }, { status: 503 });
    }

    const db = getDb();
    const [demoUser] = await db
      .select({ id: user.id })
      .from(user)
      .innerJoin(
        tenantMemberships,
        and(eq(tenantMemberships.userId, user.id), eq(tenantMemberships.tenantId, published.tenantId)),
      )
      .where(and(eq(user.id, userId), eq(tenantMemberships.status, 'active')))
      .limit(1);
    if (!demoUser) return NextResponse.json({ error: 'This demo role is not ready.' }, { status: 503 });

    const now = new Date();
    const expiresAt = new Date(
      Math.min(published.expiresAt.getTime(), now.getTime() + MAX_PUBLIC_DEMO_SESSION_MS),
    );
    if (expiresAt <= now) {
      return NextResponse.json({ error: 'The live demo has expired.' }, { status: 410 });
    }

    const token = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(session).values({
        id: token,
        token,
        userId,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });
      await tx
        .update(tenantMemberships)
        .set({ activeWorkspace: LIVE_DEMO_PERSONAS[persona].workspace })
        .where(
          and(
            eq(tenantMemberships.userId, userId),
            eq(tenantMemberships.tenantId, published.tenantId),
          ),
        );
      await tx
        .update(demoSandboxes)
        .set({
          lastAccessedAt: now,
          demoViews: sql`coalesce(${demoSandboxes.demoViews}, 0) + 1`,
        })
        .where(eq(demoSandboxes.id, published.sandboxId));
    });

    const response = NextResponse.json({
      success: true,
      redirectTo: '/dashboard',
      persona: LIVE_DEMO_PERSONAS[persona].label,
      expiresAt,
    });
    response.cookies.set('better-auth.session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
    return response;
  } catch (error) {
    console.error('[Public Live Demo] session failed:', error);
    return NextResponse.json({ error: 'The live demo could not be started.' }, { status: 500 });
  }
}
