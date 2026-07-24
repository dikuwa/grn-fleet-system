'use client';

import Link from 'next/link';
import { WifiOff, RefreshCcw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { APP_NAME } from '@/lib/constants';

export default function NetworkErrorPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-[14px] bg-amber-50">
          <WifiOff className="h-8 w-8 text-amber-700" />
        </div>
        <h1 className="text-2xl font-[650] tracking-tight text-ink-950">Network Error</h1>
        <p className="mt-2 text-sm text-ink-500">
          Unable to connect to the server. Please check your internet connection and try again.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Button variant="secondary" size="default" onClick={() => window.location.reload()}>
            <RefreshCcw className="h-4 w-4" />
            Retry
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
