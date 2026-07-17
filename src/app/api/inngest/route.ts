/**
 * Inngest Serve — Background Job Handler
 *
 * Serves the Inngest event-driven background job functions at `/api/inngest`.
 * Inngest polls this endpoint to execute scheduled jobs (reminders,
 * escalations, post-approval notifications).
 *
 * Requires INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY to be configured.
 * Gracefully returns 503 if Inngest is not configured.
 */

import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { inngestFunctions } from '@/lib/inngest/functions';
import { NextResponse } from 'next/server';

// Export the Inngest serve handler — this is what Inngest polls
export const { GET, POST, PUT } = inngest
  ? serve({
      client: inngest,
      functions: inngestFunctions,
    })
  : {
      GET: () =>
        NextResponse.json(
          { error: 'Inngest is not configured. Set INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY.' },
          { status: 503 },
        ),
      POST: () =>
        NextResponse.json(
          { error: 'Inngest is not configured.' },
          { status: 503 },
        ),
      PUT: () =>
        NextResponse.json(
          { error: 'Inngest is not configured.' },
          { status: 503 },
        ),
    };
