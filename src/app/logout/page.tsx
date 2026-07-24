'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, LogOut } from 'lucide-react';
import { authClient } from '@/lib/auth-client';

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    async function performSignOut() {
      try {
        await authClient.signOut();
      } catch {
        // Ignore errors — clear local state regardless
      }
      // Clear Better Auth session cookies only
      const cookieNames = [
        'better-auth.session_token',
        'better-auth.session_token.sig',
      ];
      cookieNames.forEach((name) => {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
      });
      router.push('/login');
    }
    performSignOut();
  }, [router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50">
          <LogOut className="h-6 w-6 text-brand-700" />
        </div>
        <h1 className="text-lg font-[650] tracking-tight text-ink-950">Signing Out</h1>
        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Please wait...
        </div>
      </div>
    </div>
  );
}
