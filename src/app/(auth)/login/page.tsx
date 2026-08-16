'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, LogIn, AlertCircle, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, FieldWrapper } from '@/components/ui/input';
import { APP_NAME } from '@/lib/constants';
import { ThemeSelector } from '@/components/layout/theme-selector';

const SIGN_IN_SERVICE_UNAVAILABLE = 'Service temporarily unavailable. Please try again later.';

/** Inner form component that calls useSearchParams */
function LoginForm() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') || '/dashboard';
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/custom-sign-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      let json: Record<string, unknown> = {};
      try {
        json = (await res.json()) as Record<string, unknown>;
      } catch {
        // Infrastructure/proxy failures are not guaranteed to return JSON.
      }

      if (!res.ok) {
        const isServiceFailure = res.status === 402 || res.status >= 500;
        const safeApiError = typeof json.error === 'string' ? json.error : null;
        setError(
          isServiceFailure
            ? SIGN_IN_SERVICE_UNAVAILABLE
            : safeApiError || 'Invalid username or password',
        );
        setLoading(false);
        return;
      }

      if (json.requiresPasswordChange) {
        window.location.assign('/dashboard/profile');
        return;
      }

      window.location.assign(redirectTo);
    } catch {
      setError('Unable to sign in. Please check your connection and try again.');
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="relative text-center">
        <ThemeSelector className="absolute -top-1 -right-1" />
        <div className="bg-brand-800 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl text-lg font-bold text-white">
          G
        </div>
        <h1 className="text-ink-950 text-xl font-[650] tracking-tight">Sign in to {APP_NAME}</h1>
        <p className="text-ink-500 mt-1 text-sm">Authorised government personnel only</p>
      </div>

      {error && (
        <div className="border-status-error-bg bg-status-error-bg/30 text-status-error-text flex items-center gap-2 rounded-[8px] border px-4 py-3 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <FieldWrapper label="Username or email" required>
          <div className="relative">
            <User className="text-ink-400 absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              type="text"
              placeholder="Enter your username or email"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              className="pl-9"
            />
          </div>
        </FieldWrapper>

        <FieldWrapper label="Password" required>
          <div className="relative">
            <Input
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="text-ink-500 hover:text-ink-700 absolute top-1/2 right-3 -translate-y-1/2"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </FieldWrapper>

        <Button type="submit" className="w-full" loading={loading}>
          <LogIn className="h-4 w-4" />
          Sign In
        </Button>
      </form>

      <p className="text-ink-500 text-center text-xs">
        Only authorised administrators can create accounts.{' '}
        <Link href="/contact" className="text-brand-600 hover:text-brand-700">
          Contact support
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6 text-center">
          <div className="bg-brand-800 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl text-lg font-bold text-white">
            G
          </div>
          <p className="text-ink-500 text-sm">Loading...</p>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
