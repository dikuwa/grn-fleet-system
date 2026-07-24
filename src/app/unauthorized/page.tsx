'use client';

import Link from 'next/link';
import { ShieldClose, LogIn, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { APP_NAME } from '@/lib/constants';

export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-[14px] bg-amber-50">
          <ShieldClose className="h-8 w-8 text-amber-700" />
        </div>
        <h1 className="text-2xl font-[650] tracking-tight text-ink-950">Authentication Required</h1>
        <p className="mt-2 text-sm text-ink-500">
          You need to sign in to access this page. Please log in with your credentials and try again.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Button variant="primary" size="default" asChild>
            <Link href="/login">
              <LogIn className="h-4 w-4" />
              Sign In
            </Link>
          </Button>
          <Button variant="secondary" size="default" asChild>
            <Link href="/">
              <Home className="h-4 w-4" />
              Home
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
