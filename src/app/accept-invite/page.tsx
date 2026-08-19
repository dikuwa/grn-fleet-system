'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { ShieldCheck, Mail, User, Loader2, AlertCircle } from 'lucide-react';

interface InvitationInfo {
  id: string;
  email: string;
  name: string | null;
  tenantId: string;
  tenantName: string;
  expiresAt: string;
  type: string;
  existingUser: boolean;
  requiresPassword: boolean;
}

function AcceptInviteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [invitation, setInvitation] = useState<InvitationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const fetchInvitation = useCallback(async () => {
    if (!token) {
      setError('No invitation token provided.');
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/auth/accept-invite?token=${encodeURIComponent(token)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Invalid invitation');
      setInvitation(json.data);
      setEmail(json.data.email);
      if (json.data.name) setName(json.data.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid or expired invitation');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchInvitation();
  }, [fetchInvitation]);

  const handleAccept = useCallback(async () => {
    if (!token || !invitation) return;
    if (invitation.requiresPassword) {
      if (password !== passwordConfirm) {
        setError('Passwords do not match.');
        return;
      }
      if (password.length < 6) {
        setError('Password must be at least 6 characters.');
        return;
      }
    }

    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          name: name.trim() || invitation.name || '',
          email,
          ...(invitation.requiresPassword ? { password } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to accept invitation');
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept invitation');
    } finally {
      setSubmitting(false);
    }
  }, [token, invitation, name, email, password, passwordConfirm]);

  if (loading) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
            <span className="ml-2 text-ink-500 text-sm">Loading invitation…</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error && !invitation && !submitting) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="space-y-4 py-8 text-center">
            <div className="mx-auto h-12 w-12 rounded-full bg-status-error-bg flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-status-error-text" />
            </div>
            <h2 className="text-lg font-semibold text-ink-900">Invalid Invitation</h2>
            <p className="text-sm text-ink-500">{error}</p>
            <p className="text-xs text-ink-400">
              Please contact your Platform Administrator to resend the invitation.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    const setupDestination = invitation?.type === 'tenant_admin' ? '/dashboard/setup' : '/dashboard';
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="space-y-4 py-8 text-center">
            <div className="mx-auto h-12 w-12 rounded-full bg-brand-50 flex items-center justify-center">
              <ShieldCheck className="h-6 w-6 text-brand-600" />
            </div>
            <h2 className="text-lg font-semibold text-ink-900">Invitation Accepted</h2>
            <p className="text-sm text-ink-500">
              Access to <strong>{invitation?.tenantName}</strong> is ready.
              {invitation?.existingUser
                ? ' Your existing GRN Fleet sign-in has been kept unchanged.'
                : ' Your GRN Fleet account has been created.'}
            </p>
            <p className="text-sm text-ink-500">
              {invitation?.type === 'tenant_admin'
                ? 'Sign in to continue with the organisation setup.'
                : 'Sign in to continue to your dashboard.'}
            </p>
            <Button
              variant="primary"
              size="default"
              onClick={() => router.push(`/login?redirect=${encodeURIComponent(setupDestination)}`)}
              className="mt-4"
            >
              Sign in to Continue →
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const passwordRequired = invitation?.requiresPassword ?? true;
  const submitLabel = invitation?.existingUser
    ? passwordRequired ? 'Accept Invitation & Set Password' : 'Accept Invitation'
    : 'Accept Invitation & Create Account';

  return (
    <div className="min-h-screen bg-muted flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center">Accept Invitation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {invitation && (
            <div className="rounded-[8px] bg-brand-50 border border-brand-200 p-3 text-sm">
              <p className="text-brand-800 font-medium">{invitation.tenantName}</p>
              <p className="text-brand-600 text-xs mt-1">
                You have been invited as a <span className="font-medium">{invitation.type.replace('_', ' ')}</span>
              </p>
              <p className="text-brand-500 text-xs mt-0.5">
                Expires {new Date(invitation.expiresAt).toLocaleDateString('en-NA', { year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
          )}

          {invitation?.existingUser && !invitation.requiresPassword && (
            <div className="rounded-[8px] border border-status-info-text/20 bg-status-info-bg/30 p-3 text-sm text-ink-600">
              This email already has a GRN Fleet account. Accepting the invitation adds this organisation to your account; your current password stays unchanged.
            </div>
          )}

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label required>Full Name</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <Input
                  type="text"
                  placeholder="Enter your full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="pl-9 h-11"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label required>Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <Input type="email" value={email} className="pl-9 h-11" disabled />
              </div>
              <p className="text-xs text-ink-400">This matches the invited email address and cannot be changed.</p>
            </div>

            {passwordRequired && (
              <>
                {invitation?.existingUser && (
                  <p className="text-xs leading-5 text-ink-500">
                    This account does not yet have a local password. Set one to sign in with email and password.
                  </p>
                )}
                <div className="space-y-1.5">
                  <Label required>Password</Label>
                  <Input
                    type="password"
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-11"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label required>Confirm Password</Label>
                  <Input
                    type="password"
                    placeholder="Repeat your password"
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    className="h-11"
                  />
                </div>
              </>
            )}
          </div>

          {error && (
            <div className="rounded-[8px] bg-status-error-bg p-3 text-sm text-status-error-text">
              {error}
            </div>
          )}

          <Button
            variant="primary"
            size="default"
            onClick={handleAccept}
            loading={submitting}
            disabled={
              submitting
              || !name.trim()
              || (passwordRequired && (!password.trim() || !passwordConfirm.trim()))
            }
            className="w-full"
          >
            {submitting ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Accepting Invitation…</>
            ) : (
              <><ShieldCheck className="h-4 w-4" /> {submitLabel}</>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

const LoadingFallback = () => (
  <div className="min-h-screen bg-muted flex items-center justify-center p-4">
    <Card className="w-full max-w-md">
      <CardContent className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
        <span className="ml-2 text-ink-500 text-sm">Loading invitation…</span>
      </CardContent>
    </Card>
  </div>
);

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <AcceptInviteContent />
    </Suspense>
  );
}
