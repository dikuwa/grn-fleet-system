'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input, Label, Textarea } from '@/components/ui/input';
import { StyledSelect } from '@/components/ui/styled-select';
import { useToast } from '@/lib/use-toast';

type IncidentReviewState = {
  investigationStatus: string;
  investigationNotes: string | null;
  administratorResponse: string | null;
  policeReference: string | null;
  policeReportFiled: boolean;
  insuranceClaimReference: string | null;
  insuranceNotified: boolean;
  technicalClearanceStatus: string;
  investigationClosedAt: string | null;
};

type ConfirmedAction =
  | 'technical_clearance'
  | 'return_vehicle_to_service'
  | 'close_investigation';

const CONFIRMATION_COPY: Record<
  ConfirmedAction,
  { title: string; description: string; confirmLabel: string }
> = {
  technical_clearance: {
    title: 'Grant technical clearance?',
    description:
      'Confirm that the vehicle has been inspected and all blocking defects are resolved. Granted clearance is final for this safety review.',
    confirmLabel: 'Grant clearance',
  },
  return_vehicle_to_service: {
    title: 'Return vehicle to service?',
    description:
      'This makes the vehicle available for operational use. The server will recheck blocking defects, active trips and unresolved safety incidents before committing the change.',
    confirmLabel: 'Return to service',
  },
  close_investigation: {
    title: 'Close investigation?',
    description:
      'This is a final investigation decision. Investigation notes are required, and vehicle-safety incidents must already have technical clearance.',
    confirmLabel: 'Close investigation',
  },
};

export function IncidentReviewActions({
  incidentId,
  initial,
  vehicleStatus,
  requiresTechnicalClearance,
  canInvestigate,
  canInsurance,
  canGrantTechnicalClearance,
  canReturnVehicleToService,
  canClose,
}: {
  incidentId: string;
  initial: IncidentReviewState;
  vehicleStatus: string;
  requiresTechnicalClearance: boolean;
  canInvestigate: boolean;
  canInsurance: boolean;
  canGrantTechnicalClearance: boolean;
  canReturnVehicleToService: boolean;
  canClose: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState({
    investigationStatus: initial.investigationStatus,
    investigationNotes: initial.investigationNotes || '',
    administratorResponse: initial.administratorResponse || '',
    policeReference: initial.policeReference || '',
    policeReportFiled: initial.policeReportFiled,
    insuranceClaimReference: initial.insuranceClaimReference || '',
    insuranceNotified: initial.insuranceNotified,
  });
  const [working, setWorking] = useState<string | null>(null);
  const [pendingConfirmedAction, setPendingConfirmedAction] = useState<ConfirmedAction | null>(null);

  async function submitReview(action: string, extra: Record<string, unknown> = {}) {
    setWorking(action);
    try {
      const response = await fetch(`/api/incidents/${incidentId}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...form, ...extra }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'The MVA record could not be updated.');
      toast({
        title: 'MVA record updated',
        description: 'The incident record and audit trail were updated.',
        variant: 'success',
      });
      router.refresh();
    } catch (error) {
      toast({
        title: 'Update failed',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'error',
      });
    } finally {
      setWorking(null);
    }
  }

  async function closeInvestigation() {
    setWorking('close_investigation');
    try {
      const response = await fetch(`/api/incidents/${incidentId}/investigation`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'closed',
          notes: form.investigationNotes.trim(),
          accidentReportNumber: undefined,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'The investigation could not be closed.');
      toast({
        title: 'Investigation closed',
        description: 'The final investigation decision and audit trail were recorded.',
        variant: 'success',
      });
      router.refresh();
    } catch (error) {
      toast({
        title: 'Closure failed',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'error',
      });
    } finally {
      setWorking(null);
    }
  }

  async function confirmPendingAction() {
    if (!pendingConfirmedAction) return;
    const action = pendingConfirmedAction;
    if (action === 'close_investigation') {
      await closeInvestigation();
      return;
    }
    await submitReview(action);
  }

  const confirmation = pendingConfirmedAction
    ? CONFIRMATION_COPY[pendingConfirmedAction]
    : null;

  return (
    <div className="space-y-4">
      {canInvestigate && (
        <Card>
          <CardHeader><CardTitle>Investigation & police follow-up</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Investigation status</Label>
                <StyledSelect value={form.investigationStatus} onChange={(event) => setForm((value) => ({ ...value, investigationStatus: event.target.value }))}>
                  <option value="pending">Pending</option>
                  <option value="in_progress">In progress</option>
                  <option value="awaiting_information">Awaiting information</option>
                </StyledSelect>
                <p className="text-ink-500 text-xs leading-5">Use the dedicated Close investigation action for final closure so technical-clearance, closure permission and required findings are enforced.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="police-reference">Police reference</Label>
                <Input id="police-reference" value={form.policeReference} onChange={(event) => setForm((value) => ({ ...value, policeReference: event.target.value }))} placeholder="Case / CR number" />
              </div>
            </div>
            <label className="border-border flex cursor-pointer items-center gap-3 rounded-[8px] border p-3 text-sm text-ink-700">
              <input type="checkbox" checked={form.policeReportFiled} onChange={(event) => setForm((value) => ({ ...value, policeReportFiled: event.target.checked }))} className="accent-brand-700 h-4 w-4" />
              Police report filed / reference confirmed
            </label>
            <div className="space-y-1.5">
              <Label htmlFor="investigation-notes">Investigation notes</Label>
              <Textarea id="investigation-notes" rows={5} value={form.investigationNotes} onChange={(event) => setForm((value) => ({ ...value, investigationNotes: event.target.value }))} placeholder="Findings, witness follow-up, third-party information and next action…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="administrator-response">Operational response</Label>
              <Textarea id="administrator-response" rows={3} value={form.administratorResponse} onChange={(event) => setForm((value) => ({ ...value, administratorResponse: event.target.value }))} placeholder="Recovery, replacement vehicle, route decision or operational instruction…" />
            </div>
            <Button loading={working === 'investigation_update'} onClick={() => void submitReview('investigation_update')}>Save investigation</Button>
          </CardContent>
        </Card>
      )}

      {canInsurance && (
        <Card>
          <CardHeader><CardTitle>Insurance</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="insurance-reference">Insurance claim reference</Label>
              <Input id="insurance-reference" value={form.insuranceClaimReference} onChange={(event) => setForm((value) => ({ ...value, insuranceClaimReference: event.target.value }))} placeholder="Claim number" />
            </div>
            <label className="border-border flex cursor-pointer items-center gap-3 rounded-[8px] border p-3 text-sm text-ink-700">
              <input type="checkbox" checked={form.insuranceNotified} onChange={(event) => setForm((value) => ({ ...value, insuranceNotified: event.target.checked }))} className="accent-brand-700 h-4 w-4" />
              Insurer notified
            </label>
            <Button variant="secondary" loading={working === 'insurance_update'} onClick={() => void submitReview('insurance_update')}>Save insurance status</Button>
          </CardContent>
        </Card>
      )}

      {(canGrantTechnicalClearance || canReturnVehicleToService || canClose) && (
        <Card>
          <CardHeader><CardTitle>Clearance & closure</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-ink-500 text-xs leading-5">
              Technical clearance is blocked while any blocking vehicle defect remains unresolved. Returning the vehicle to service is separately blocked while an active trip or another unresolved vehicle-safety incident still restricts the vehicle.
            </p>
            <div className="flex flex-wrap gap-2">
              {canGrantTechnicalClearance && initial.technicalClearanceStatus !== 'cleared' && (
                <Button variant="secondary" loading={working === 'technical_clearance'} onClick={() => setPendingConfirmedAction('technical_clearance')}>Grant technical clearance</Button>
              )}
              {canReturnVehicleToService && initial.technicalClearanceStatus === 'cleared' && vehicleStatus !== 'available' && (
                <Button loading={working === 'return_vehicle_to_service'} onClick={() => setPendingConfirmedAction('return_vehicle_to_service')}>Return vehicle to service</Button>
              )}
              {canClose && initial.investigationClosedAt == null && (
                <Button
                  variant="secondary"
                  loading={working === 'close_investigation'}
                  disabled={!form.investigationNotes.trim()}
                  onClick={() => setPendingConfirmedAction('close_investigation')}
                >
                  Close investigation
                </Button>
              )}
            </div>
            {canClose && initial.investigationClosedAt == null && !form.investigationNotes.trim() && (
              <p className="text-ink-500 text-xs">Add investigation findings before final closure.</p>
            )}
            {requiresTechnicalClearance && initial.technicalClearanceStatus !== 'cleared' && (
              <p className="text-status-pending-text text-xs">This incident placed the vehicle under a safety hold. The investigation cannot be closed until technical clearance is complete.</p>
            )}
          </CardContent>
        </Card>
      )}

      {confirmation ? (
        <ConfirmDialog
          open={pendingConfirmedAction !== null}
          onOpenChange={(open) => !open && setPendingConfirmedAction(null)}
          title={confirmation.title}
          description={confirmation.description}
          confirmLabel={confirmation.confirmLabel}
          onConfirm={confirmPendingAction}
        />
      ) : null}
    </div>
  );
}
