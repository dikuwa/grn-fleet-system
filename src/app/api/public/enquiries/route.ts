/**
 * Public Enquiries API.
 *
 * POST /api/public/enquiries — Submit a contact-form message from the
 * public website. Persists to `cms_enquiries` so Platform Admin can review
 * and manage submissions. No auth required (public form), but input is
 * validated, length-limited and rate-lightly-throttled by email.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { cmsEnquiries } from '@/db/schema/cms-content';
import { eq } from 'drizzle-orm';

const MAX_NAME = 120;
const MAX_EMAIL = 254;
const MAX_PHONE = 40;
const MAX_SUBJECT = 200;
const MAX_MESSAGE = 5000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const name = clean(body.name).slice(0, MAX_NAME);
    const email = clean(body.email).toLowerCase().slice(0, MAX_EMAIL);
    const phone = clean(body.phone).slice(0, MAX_PHONE) || null;
    const subject = clean(body.subject).slice(0, MAX_SUBJECT);
    const message = clean(body.message).slice(0, MAX_MESSAGE);
    const category = clean(body.category) || 'general';

    if (!name || !email || !subject || !message) {
      return NextResponse.json(
        { error: 'Missing required fields: name, email, subject, message' },
        { status: 400 },
      );
    }

    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    const db = getDb();

    // Light duplicate/spam guard: block rapid resubmission from the same
    // email within 60 seconds.
    const since = new Date(Date.now() - 60_000);
    const [recentEnquiry] = await db
      .select({ createdAt: cmsEnquiries.createdAt })
      .from(cmsEnquiries)
      .where(eq(cmsEnquiries.email, email))
      .orderBy(cmsEnquiries.createdAt)
      .limit(1);

    if (recentEnquiry && recentEnquiry.createdAt > since) {
      return NextResponse.json(
        { error: 'Please wait a moment before sending another message' },
        { status: 429 },
      );
    }

    const [enquiry] = await db
      .insert(cmsEnquiries)
      .values({
        name,
        email,
        phone,
        subject,
        message,
        category,
        status: 'new',
        source: 'contact_form',
      })
      .returning({ id: cmsEnquiries.id });

    return NextResponse.json({ success: true, data: { id: enquiry.id } }, { status: 201 });
  } catch (error) {
    console.error('[public/enquiries] POST failed:', error);
    return NextResponse.json({ error: 'Unable to send your message. Please try again.' }, { status: 500 });
  }
}
