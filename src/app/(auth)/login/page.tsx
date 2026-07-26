'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, LogIn, AlertCircle, User, Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, FieldWrapper } from '@/components/ui/input';
import { APP_NAME } from '@/lib/constants';
import { useTheme } from '@/lib/theme-provider';

/** Inner form component that calls useSearchParams */
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') || '/dashboard';
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { theme, toggleTheme } = useTheme();

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

      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Invalid username or password');
        setLoading(false);
        return;
      }

      if (json.requiresPasswordChange) {
        router.push('/dashboard/profile');
        return;
      }

      router.push(redirectTo);
    } catch (err) {
      setError('Unable to sign in. Please check your connection and try again.');
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="relative text-center">
        <button
          onClick={toggleTheme}
          className="absolute -right-1 -top-1 flex h-9 w-9 items-center justify-center rounded-[8px] text-ink-500 hover:bg-muted transition-colors"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? (
            <Sun className="h-[18px] w-[18px]" />
          ) : (
            <Moon className="h-[18px] w-[18px]" />
          )}
        </button>
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-800 text-lg font-bold text-white">
          G
        </div>
        <h1 className="text-xl font-[650] tracking-tight text-ink-950">
          Sign in to {APP_NAME}
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Authorised government personnel only
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-[8px] border border-status-error-bg bg-status-error-bg/30 px-4 py-3 text-sm text-status-error-text">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <FieldWrapper label="Username or email" required>
          <div className="relative">
            <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
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
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-500 hover:text-ink-700"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
        </FieldWrapper>

        <Button type="submit" className="w-full" loading={loading}>
          <LogIn className="h-4 w-4" />
          Sign In
        </Button>
      </form>

      <p className="text-center text-xs text-ink-500">
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
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-800 text-lg font-bold text-white">
            G
          </div>
          <p className="text-sm text-ink-500">Loading...</p>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
