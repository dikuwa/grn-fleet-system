'use client';

import { useState, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Wrench, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { TechnicalClearanceStatus } from '@/lib/incidents/mva-constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TechnicalClearanceForm({ incidentId, data, onUpdate }: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [pendingDecision, setPendingDecision] = useState<'cleared' | 'not_cleared' | null>(null);

  const status = data.technicalClearanceStatus;
  const isAlreadyCleared = status === 'cleared';
  const isNotCleared = status === 'not_cleared';
  const isResolved = isAlreadyCleared || isNotCleared;

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
        {isResolved ? (
          <div className="space-y-3">
            <div
              className={`flex items-center gap-2 rounded-lg p-3 text-sm ${
                isAlreadyCleared
                  ? 'bg-green-50 text-green-800 dark:bg-green-950/30 dark:text-green-200'
                  : 'bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-200'
              }`}
            >
              {isAlreadyCleared ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              Vehicle has been {isAlreadyCleared ? 'technically cleared' : 'declared not clear'}
              {data.technicalClearanceAt ? (
                <span className="ml-auto text-xs opacity-80">
                  {new Date(data.technicalClearanceAt).toLocaleString()}
                </span>
              ) : null}
            </div>
            {data.technicalClearanceByUserId ? (
              <p className="text-ink-500 text-xs">
                Cleared by: {data.technicalClearanceByUserId.slice(0, 8)}...
              </p>
            ) : null}

            {!isNotCleared && (
              <Button
                size="compact"
                variant="destructive"
                onClick={() => requestClearance('not_cleared')}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="mr-1 h-4 w-4" />
                )}
                Revoke clearance (not cleared)
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-ink-600 text-sm">
              A designated officer must confirm the vehicle has been inspected and is safe to return
              to service. This is the final step before the vehicle can be released from the
              maintenance hold.
            </p>
            <div className="flex gap-3">
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
                Issue clearance (vehicle safe)
              </Button>
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
            ? 'This confirms the vehicle has been inspected and is safe to return to service.'
            : 'The vehicle must not be released. A designated officer will need to re-inspect before it can return to service.'
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
