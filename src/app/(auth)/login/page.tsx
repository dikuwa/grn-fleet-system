'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, LogIn, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, FieldWrapper } from '@/components/ui/input';
import { APP_NAME } from '@/lib/constants';
import { signIn } from '@/lib/auth-client';

/** Inner form component that calls useSearchParams */
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') || '/dashboard';
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const result = await signIn.email({
        email,
        password,
      });

      if (result.error) {
        setError(result.error.message || 'Invalid email or password');
        setLoading(false);
        return;
      }

      router.push(redirectTo);
    } catch (err) {
      setError('Unable to sign in. Please check your connection and try again.');
      console.error('Sign in failed:', err);
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
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
        <FieldWrapper label="Email" required>
          <Input
            type="email"
            placeholder="name@example.gov.na"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
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
