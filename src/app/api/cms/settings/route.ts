/**
 * Public Site Settings API
 *
 * GET /api/cms/settings — Return public site settings (no auth).
 */

import { NextResponse } from 'next/server';
import { getPublicSiteSettings } from '@/lib/platform/cms-public';

export async function GET() {
  try {
    const settings = await getPublicSiteSettings();
    return NextResponse.json({ success: true, data: settings });
  } catch (error) {
    console.error('[cms/settings] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load site settings' }, { status: 500 });
  }
}