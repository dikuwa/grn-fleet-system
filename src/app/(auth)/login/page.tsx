'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, FieldWrapper } from '@/components/ui/input';
import { APP_NAME } from '@/lib/constants';

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // Auth integration will replace this in Phase 2
    setTimeout(() => setLoading(false), 1000);
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

      <form onSubmit={handleSubmit} className="space-y-4">
        <FieldWrapper label="Email" required>
          <Input
            type="email"
            placeholder="name@example.gov.na"
            required
            autoComplete="email"
          />
        </FieldWrapper>

        <FieldWrapper label="Password" required>
          <div className="relative">
            <Input
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter your password"
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
