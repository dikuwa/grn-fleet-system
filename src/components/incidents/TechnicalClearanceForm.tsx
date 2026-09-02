'use client';

import { useState, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Wrench, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { TechnicalClearanceStatus } from '@/lib/incidents/mva-constants';

interface TechnicalClearanceData {
  technicalClearanceStatus: TechnicalClearanceStatus;
  technicalClearanceAt: string | null;
  technicalClearanceByUserId: string | null;
}

const STATUS_LABELS: Record<TechnicalClearanceStatus, string> = {
  pending: 'Pending',
  cleared: 'Cleared',
  not_cleared: 'Not cleared',
};

const STATUS_BADGE: Record<TechnicalClearanceStatus, 'info' | 'success' | 'error'> = {
  pending: 'info',
  cleared: 'success',
  not_cleared: 'error',
};

interface Props {
  incidentId: string;
  data: TechnicalClearanceData;
  onUpdate: () => void;
}

export function TechnicalClearanceForm({ incidentId, data, onUpdate }: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [pendingDecision, setPendingDecision] = useState<'cleared' | 'not_cleared' | null>(null);

  const status = data.technicalClearanceStatus;
  const isAlreadyCleared = status === 'cleared';
  const isNotCleared = status === 'not_cleared';

  const issueClearance = useCallback(
    async (decision: 'cleared' | 'not_cleared') => {
      setSaving(true);
      try {
        const res = await fetch(`/api/incidents/${incidentId}/technical-clearance`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: decision }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Update failed');
        toast({
          title: decision === 'cleared' ? 'Technical clearance issued' : 'Vehicle not cleared',
          variant: decision === 'cleared' ? 'success' : 'error',
        });
        onUpdate();
      } catch (err) {
        toast({
          title: 'Error',
          description: err instanceof Error ? err.message : 'Update failed',
          variant: 'error',
        });
      } finally {
        setSaving(false);
      }
    },
    [incidentId, toast, onUpdate],
  );

  const requestClearance = (decision: 'cleared' | 'not_cleared') => {
    setPendingDecision(decision);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Wrench className="h-4 w-4" />
          Technical Clearance
          <Badge variant={STATUS_BADGE[status]} size="sm">
            {STATUS_LABELS[status]}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAlreadyCleared ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950/30 dark:text-green-200">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Vehicle has been technically cleared.</span>
              {data.technicalClearanceAt ? (
                <span className="ml-auto text-xs opacity-80">
                  {new Date(data.technicalClearanceAt).toLocaleString()}
                </span>
              ) : null}
            </div>
            {data.technicalClearanceByUserId ? (
              <p className="text-ink-500 text-xs">
                Decision recorded by: {data.technicalClearanceByUserId.slice(0, 8)}...
              </p>
            ) : null}
            <p className="text-ink-600 text-sm">
              Granted technical clearance is final for this safety review. If the vehicle becomes
              unsafe again, record a new defect or incident so a new restriction and clearance cycle
              is created with its own audit trail.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {isNotCleared ? (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1">
                  <p>Vehicle is not cleared and must remain out of service.</p>
                  <p className="text-xs opacity-80">
                    After the blocking defect is resolved and the vehicle is re-inspected, technical
                    clearance can be issued here.
                  </p>
                </div>
                {data.technicalClearanceAt ? (
                  <span className="ml-auto shrink-0 text-xs opacity-80">
                    {new Date(data.technicalClearanceAt).toLocaleString()}
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="text-ink-600 text-sm">
                A designated officer must confirm the vehicle has been inspected and is safe to
                return to service. This is the final safety decision before the maintenance hold can
                be released.
              </p>
            )}

            {data.technicalClearanceByUserId && isNotCleared ? (
              <p className="text-ink-500 text-xs">
                Decision recorded by: {data.technicalClearanceByUserId.slice(0, 8)}...
              </p>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <Button
                variant="primary"
                size="compact"
                onClick={() => requestClearance('cleared')}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-1 h-4 w-4" />
                )}
                {isNotCleared ? 'Issue clearance after re-inspection' : 'Issue clearance (vehicle safe)'}
              </Button>
              {!isNotCleared ? (
                <Button
                  variant="destructive"
                  size="compact"
                  onClick={() => requestClearance('not_cleared')}
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <XCircle className="mr-1 h-4 w-4" />
                  )}
                  Not cleared
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={pendingDecision !== null}
        onOpenChange={(open) => !open && setPendingDecision(null)}
        title={
          pendingDecision === 'cleared'
            ? 'Issue technical clearance?'
            : 'Mark vehicle as not cleared?'
        }
        description={
          pendingDecision === 'cleared'
            ? 'This confirms the vehicle has been re-inspected, all blocking defects are resolved, and it is safe for the clearance stage.'
            : 'The vehicle must remain out of service. Clearance can be issued later after the blocking defect is resolved and the vehicle is re-inspected.'
        }
        confirmLabel={pendingDecision === 'cleared' ? 'Issue clearance' : 'Not cleared'}
        variant={pendingDecision === 'not_cleared' ? 'destructive' : 'default'}
        onConfirm={() => {
          if (pendingDecision) return issueClearance(pendingDecision);
        }}
      />
    </Card>
  );
}
