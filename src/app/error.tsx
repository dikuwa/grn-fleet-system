'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCcw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { APP_NAME } from '@/lib/constants';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Application error:', error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-[14px] bg-status-error-bg">
          <AlertTriangle className="h-8 w-8 text-status-error-text" />
        </div>
        <h1 className="text-2xl font-[650] tracking-tight text-ink-950">Something Went Wrong</h1>
        <p className="mt-2 text-sm text-ink-500">
          An unexpected error occurred. Our team has been notified. Please try again or return to the dashboard.
        </p>
        {process.env.NODE_ENV === 'development' && (
          <div className="mt-4 rounded-[8px] border border-status-error-bg bg-status-error-bg/30 p-3 text-left">
            <p className="text-xs font-mono text-status-error-text break-all">
              {error.message}
            </p>
            {error.digest && (
              <p className="mt-1 text-xs font-mono text-ink-500">Error ID: {error.digest}</p>
            )}
          </div>
        )}
        <div className="mt-8 flex items-center justify-center gap-3">
          <Button variant="secondary" size="default" onClick={reset}>
            <RefreshCcw className="h-4 w-4" />
            Try Again
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
