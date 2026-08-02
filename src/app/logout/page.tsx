'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, LogOut } from 'lucide-react';
import { authClient } from '@/lib/auth-client';

export default function LogoutPage() {
  const queryClient = useQueryClient();

  useEffect(() => {
    async function performSignOut() {
      try {
        await authClient.signOut();
      } catch {
        // Ignore errors — clear local state regardless
      }
      // Clear Better Auth session cookies only
      const cookieNames = ['better-auth.session_token', 'better-auth.session_token.sig'];
      cookieNames.forEach((name) => {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
      });
      queryClient.clear();
      window.location.replace('/login');
    }
    performSignOut();
  }, [queryClient]);

  return (
    <div className="bg-canvas flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="bg-brand-50 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl">
          <LogOut className="text-brand-700 h-6 w-6" />
        </div>
        <h1 className="text-ink-950 text-lg font-[650] tracking-tight">Signing Out</h1>
        <div className="text-ink-500 mt-4 flex items-center justify-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Please wait...
        </div>
      </div>
    </div>
  );
}
