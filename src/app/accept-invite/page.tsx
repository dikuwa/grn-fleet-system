'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { ShieldCheck, Mail, User, Loader2, AlertCircle } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InvitationInfo {
  id: string;
  email: string;
  name: string | null;
  tenantId: string;
  tenantName: string;
  expiresAt: string;
  type: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // Fetch invitation details
  // -----------------------------------------------------------------------

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
    fetchInvitation();
  }, [fetchInvitation]);

  // -----------------------------------------------------------------------
  // Accept
  // -----------------------------------------------------------------------

  const handleAccept = useCallback(async () => {
    if (!token) return;
    if (password !== passwordConfirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name: name.trim() || invitation?.name || '', email, password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to accept invitation');
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept invitation');
    } finally {
      setSubmitting(false);
    }
  }, [token, name, email, password, passwordConfirm, invitation]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

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

  // Invalid / expired token
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

  // Success screen
  if (submitted) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="space-y-4 py-8 text-center">
            <div className="mx-auto h-12 w-12 rounded-full bg-brand-50 flex items-center justify-center">
              <ShieldCheck className="h-6 w-6 text-brand-600" />
            </div>
            <h2 className="text-lg font-semibold text-ink-900">Account Created Successfully</h2>
            <p className="text-sm text-ink-500">
              Welcome to <strong>{invitation?.tenantName}</strong> on the GovFleet platform.
              Your Tenant Administrator account is now active.
            </p>
            <p className="text-sm text-ink-500">
              You will be redirected to your workspace setup wizard to complete your
              organisation profile and begin managing your fleet.
            </p>
            <Button
              variant="primary"
              size="default"
              onClick={() => router.push('/dashboard/setup')}
              className="mt-4"
            >
              Begin Setup →
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center">
            Accept Invitation
          </CardTitle>
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
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9 h-11"
                  disabled
                />
              </div>
              <p className="text-xs text-ink-400">This matches the invited email address and cannot be changed.</p>
            </div>

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
            disabled={submitting || !name.trim() || !password.trim() || !passwordConfirm.trim()}
            className="w-full"
          >
            {submitting ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Creating Account…</>
            ) : (
              <><ShieldCheck className="h-4 w-4" /> Accept Invitation & Create Account</>
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