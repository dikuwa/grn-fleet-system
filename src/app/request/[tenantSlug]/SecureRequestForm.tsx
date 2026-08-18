'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/input';
import { StyledDateInput, StyledSelect } from '@/components/ui/styled-select';
import { CheckCircle2, Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react';

type Step = 'identity' | 'otp' | 'request' | 'complete';
type VerifiedEmployee = {
  firstName: string;
  lastName: string;
  employeeNumber: string;
  email?: string | null;
  phone?: string | null;
};

export function SecureRequestForm({
  tenantSlug,
  tenantName,
}: {
  tenantSlug: string;
  tenantName: string;
}) {
  const [step, setStep] = useState<Step>('identity');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [verificationId, setVerificationId] = useState('');
  const [destination, setDestination] = useState('');
  const [employee, setEmployee] = useState<VerifiedEmployee | null>(null);
  const [reference, setReference] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [passengers, setPassengers] = useState<string[]>([]);
  const clientSubmissionId = useMemo(() => crypto.randomUUID(), []);

  async function submitIdentity(formData: FormData) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/public/requests/${tenantSlug}/otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeNumber: formData.get('employeeNumber'),
          surname: formData.get('surname'),
          verifier: formData.get('verifier'),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Verification is temporarily unavailable.');
        return;
      }

      if (data.mode === 'directory' && data.employee) {
        setEmployee(data.employee);
        setStep('request');
        return;
      }

      if (data.mode !== 'otp' || !data.verificationId) {
        setError('We could not verify the information provided.');
        return;
      }
      setVerificationId(data.verificationId);
      setDestination(data.destination || 'your registered email');
      setStep('otp');
    } finally {
      setBusy(false);
    }
  }

  async function submitOtp(formData: FormData) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/public/requests/${tenantSlug}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verificationId, otp: formData.get('otp') }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'The code could not be verified.');
        return;
      }
      setEmployee(data.employee);
      setStep('request');
    } finally {
      setBusy(false);
    }
  }

  async function submitRequest(formData: FormData) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/public/requests/${tenantSlug}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': clientSubmissionId },
        body: JSON.stringify({
          clientSubmissionId,
          purpose: formData.get('purpose'),
          scope: formData.get('scope'),
          origin: formData.get('origin'),
          destination: formData.get('destination'),
          departureAt: formData.get('departureAt'),
          returnAt: formData.get('returnAt'),
          urgency: formData.get('urgency'),
          overnight: formData.get('overnight') === 'on',
          driverPreference: formData.get('driverPreference'),
          specialRequirements: formData.get('specialRequirements'),
          passengers: passengers.filter(Boolean).map((externalName) => ({ externalName })),
          proposedCorrections: {
            phone: String(formData.get('correctedPhone') || ''),
            email: String(formData.get('correctedEmail') || ''),
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'The request could not be submitted.');
        return;
      }
      setReference(data.request.reference);
      setTrackingUrl(data.trackingUrl);
      setStep('complete');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'complete') {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-status-success-text" />
          <h2 className="mt-4 text-xl font-semibold text-ink-950">Request received</h2>
          <p className="mt-2 text-sm text-ink-600">
            Your reference is <strong>{reference}</strong>.
          </p>
          <p className="mt-1 text-sm text-ink-500">
            Save this reference or use the tracking link below to check progress.
          </p>
          <Button className="mt-6 w-full sm:w-auto" asChild>
            <a href={trackingUrl}>Track request</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>
              {step === 'identity'
                ? 'Verify your staff identity'
                : step === 'otp'
                  ? 'Enter verification code'
                  : 'Transport request'}
            </CardTitle>
            <p className="mt-1 text-sm text-ink-500">
              {step === 'identity'
                ? `${tenantName} employees can request without a dashboard account.`
                : step === 'otp'
                  ? `Code sent to ${destination}.`
                  : `Requested for ${employee?.firstName} ${employee?.lastName}.`}
            </p>
          </div>
          <ShieldCheck className="h-6 w-6 shrink-0 text-brand-700" />
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div
            role="alert"
            className="mb-4 rounded-[8px] border border-status-error-text/20 bg-status-error-bg p-3 text-sm text-status-error-text"
          >
            {error}
          </div>
        )}

        {step === 'identity' && (
          <form action={submitIdentity} className="space-y-4">
            <div className="space-y-1.5">
              <Label required>Employee number</Label>
              <Input name="employeeNumber" autoComplete="username" required />
            </div>
            <div className="space-y-1.5">
              <Label required>Surname</Label>
              <Input name="surname" autoComplete="family-name" required />
            </div>
            <div className="space-y-1.5">
              <Label required>Registered email or mobile number</Label>
              <Input name="verifier" autoComplete="email" required />
            </div>
            <p className="text-xs leading-relaxed text-ink-500">
              We match these details against the active staff directory. Where email delivery is
              configured, a one-time code is sent before you continue. The same failure response is
              used whether or not an employee record exists.
            </p>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Verify and continue
            </Button>
          </form>
        )}

        {step === 'otp' && (
          <form action={submitOtp} className="space-y-4">
            <div className="space-y-1.5">
              <Label required>Six-digit code</Label>
              <Input
                name="otp"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                className="text-center text-lg tracking-[0.3em]"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Verify and continue
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => {
                setStep('identity');
                setError('');
              }}
            >
              Start again
            </Button>
          </form>
        )}

        {step === 'request' && (
          <form action={submitRequest} className="space-y-5">
            <div className="rounded-[8px] border border-border bg-canvas p-3 text-sm">
              <p className="font-medium text-ink-950">
                {employee?.firstName} {employee?.lastName}
              </p>
              <p className="text-xs text-ink-500">
                Employee {employee?.employeeNumber} · Submission method: Secure staff link
              </p>
            </div>
            <div className="space-y-1.5">
              <Label required>Purpose of travel</Label>
              <Textarea name="purpose" rows={3} required />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label required>Origin</Label>
                <Input name="origin" required />
              </div>
              <div className="space-y-1.5">
                <Label required>Destination</Label>
                <Input name="destination" required />
              </div>
              <div className="space-y-1.5">
                <Label required>Departure</Label>
                <StyledDateInput name="departureAt" type="datetime-local" required />
              </div>
              <div className="space-y-1.5">
                <Label required>Expected return</Label>
                <StyledDateInput name="returnAt" type="datetime-local" required />
              </div>
              <div className="space-y-1.5">
                <Label>Trip scope</Label>
                <StyledSelect name="scope" defaultValue="regional">
                  <option value="regional">Regional</option>
                  <option value="national">National</option>
                </StyledSelect>
              </div>
              <div className="space-y-1.5">
                <Label>Urgency</Label>
                <StyledSelect name="urgency" defaultValue="normal">
                  <option value="normal">Normal</option>
                  <option value="urgent">Urgent</option>
                  <option value="emergency">Emergency</option>
                </StyledSelect>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Driver preference</Label>
              <StyledSelect name="driverPreference" defaultValue="transport_admin_assign">
                <option value="transport_admin_assign">Transport Administrator should assign</option>
                <option value="requester_qualified_driver">I am a qualified driver and may drive</option>
                <option value="no_preference">No preference</option>
              </StyledSelect>
              <p className="text-xs text-ink-500">
                A preference is not a final assignment and remains subject to availability and
                compliance.
              </p>
            </div>
            <div className="space-y-3 rounded-[8px] border border-border p-4">
              <div className="flex items-center justify-between gap-3">
                <Label>Additional passengers</Label>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setPassengers([...passengers, ''])}
                >
                  <Plus className="h-4 w-4" />Add
                </Button>
              </div>
              {passengers.map((passenger, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    value={passenger}
                    onChange={(event) =>
                      setPassengers(
                        passengers.map((value, position) =>
                          position === index ? event.target.value : value,
                        ),
                      )
                    }
                    placeholder="Passenger full name"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove passenger"
                    onClick={() =>
                      setPassengers(passengers.filter((_, position) => position !== index))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {!passengers.length && (
                <p className="text-xs text-ink-500">
                  You are included as the travelling employee automatically.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Special requirements</Label>
              <Textarea name="specialRequirements" rows={2} />
            </div>
            <details className="rounded-[8px] border border-border p-4">
              <summary className="cursor-pointer text-sm font-medium text-ink-800">
                Suggest a contact correction
              </summary>
              <p className="mt-2 text-xs text-ink-500">
                Changes are sent to administration for approval and do not immediately alter the
                directory.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Input name="correctedPhone" placeholder="Updated phone" />
                <Input name="correctedEmail" type="email" placeholder="Updated email" />
              </div>
            </details>
            <label className="flex items-start gap-2 text-sm text-ink-700">
              <input name="overnight" type="checkbox" className="mt-1 h-4 w-4" />
              This trip includes an overnight stay.
            </label>
            <div className="sticky bottom-0 -mx-4 border-t border-border bg-surface/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:p-0">
              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Submit transport request
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
