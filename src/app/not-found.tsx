'use client';

import Link from 'next/link';
import { FileQuestion, Home, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { APP_NAME } from '@/lib/constants';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-[14px] bg-brand-50">
          <FileQuestion className="h-8 w-8 text-brand-700" />
        </div>
        <h1 className="text-4xl font-[650] tracking-tight text-ink-950">404</h1>
        <p className="mt-2 text-lg font-medium text-ink-950">Page Not Found</p>
        <p className="mt-2 text-sm text-ink-500">
          The page you&apos;re looking for doesn&apos;t exist or has been moved. Check the URL or navigate back.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Button variant="secondary" size="default" asChild>
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
              Go Home
            </Link>
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
