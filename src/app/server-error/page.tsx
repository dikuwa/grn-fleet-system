'use client';

import Link from 'next/link';
import { ServerCrash, RefreshCcw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { APP_NAME } from '@/lib/constants';

export default function ServerErrorPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-[14px] bg-status-error-bg">
          <ServerCrash className="h-8 w-8 text-status-error-text" />
        </div>
        <h1 className="text-2xl font-[650] tracking-tight text-ink-950">Server Error</h1>
        <p className="mt-2 text-sm text-ink-500">
          The server encountered an internal error and could not complete your request. Please try again later.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Button variant="secondary" size="default" onClick={() => window.location.reload()}>
            <RefreshCcw className="h-4 w-4" />
            Refresh Page
          </Button>
          <Button variant="primary" size="default" asChild>
            <Link href="/dashboard">
              <Home className="h-4 w-4" />
              Dashboard
            </Link>
          </Button>
        </div>
        <p className="mt-8 text-xs text-ink-400">
          &copy; {new Date().getFullYear()} {APP_NAME}. All rights reserved.
        </p>
      </div>
    </div>
  );
}
