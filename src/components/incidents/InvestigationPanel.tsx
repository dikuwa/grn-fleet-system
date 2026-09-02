'use client';

import { useState, useCallback, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Label, Textarea } from '@/components/ui/input';
import { StyledSelect } from '@/components/ui/styled-select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Search,
  Save,
  Plus,
  Loader2,
  FileText,
  CheckCircle2,
  LockKeyhole,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import { INVESTIGATION_STATUSES } from '@/lib/incidents/mva-constants';
import type { InvestigationStatus } from '@/lib/incidents/mva-constants';

interface InvestigationData {
  investigationStatus: InvestigationStatus;
  investigationNotes: string | null;
  investigationClosedAt: string | null;
  accidentReportNumber: string | null;
  witnessStatements: Array<Record<string, unknown>> | null;
}

const STATUS_LABELS: Record<InvestigationStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  closed: 'Closed',
  no_action: 'No action required',
};

const STATUS_BADGE: Record<InvestigationStatus, 'info' | 'success' | 'warning' | 'default'> = {
  pending: 'default',
  in_progress: 'info',
  closed: 'success',
  no_action: 'default',
};

const EDITABLE_INVESTIGATION_STATUSES = INVESTIGATION_STATUSES.filter(
  (status) => status !== 'closed',
);

interface Props {
  incidentId: string;
  tripId: string;
  data: InvestigationData;
  onUpdate: () => void;
  canInvestigate?: boolean;
  canCloseInvestigation?: boolean;
}

export function InvestigationPanel({
  incidentId,
  data,
  onUpdate,
  canInvestigate = true,
  canCloseInvestigation: explicitCanCloseInvestigation,
}: Props) {
  const { toast } = useToast();
  const [status, setStatus] = useState<InvestigationStatus>(data.investigationStatus);
  const [notes, setNotes] = useState(data.investigationNotes || '');
  const [reportNumber, setReportNumber] = useState(data.accidentReportNumber || '');
  const [saving, setSaving] = useState(false);
  const [canCloseInvestigation, setCanCloseInvestigation] = useState(
    explicitCanCloseInvestigation ?? false,
  );
  const [closeCapabilityResolved, setCloseCapabilityResolved] = useState(
    explicitCanCloseInvestigation !== undefined,
  );
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const [witnessName, setWitnessName] = useState('');
  const [witnessPhone, setWitnessPhone] = useState('');
  const [witnessStatement, setWitnessStatement] = useState('');
  const [addingWitness, setAddingWitness] = useState(false);

  const witnesses = Array.isArray(data.witnessStatements) ? data.witnessStatements : [];
  const isClosed = data.investigationStatus === 'closed';
  const isReadOnly = isClosed || !canInvestigate;

  useEffect(() => {
    if (explicitCanCloseInvestigation !== undefined) {
      setCanCloseInvestigation(explicitCanCloseInvestigation);
      setCloseCapabilityResolved(true);
      return;
    }

    let active = true;

    async function resolveCloseCapability() {
      try {
        const response = await fetch(`/api/incidents/${incidentId}/investigation`);
        const json = await response.json().catch(() => ({}));
        if (!active) return;
        setCanCloseInvestigation(
          response.ok && json.capabilities?.canCloseInvestigation === true,
        );
      } catch {
        if (active) setCanCloseInvestigation(false);
      } finally {
        if (active) setCloseCapabilityResolved(true);
      }
    }

    void resolveCloseCapability();
    return () => {
      active = false;
    };
  }, [incidentId, explicitCanCloseInvestigation]);

  const saveInvestigation = useCallback(async (
    requestedStatus: InvestigationStatus = status,
  ) => {
    if (requestedStatus === 'closed') {
      if (!canCloseInvestigation) return;
    } else if (!canInvestigate) {
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/investigation`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: requestedStatus,
          notes,
          accidentReportNumber: reportNumber.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Update failed');
      toast({
        title: requestedStatus === 'closed' ? 'Investigation closed' : 'Investigation updated',
        variant: 'success',
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
  }, [incidentId, status, notes, reportNumber, canInvestigate, canCloseInvestigation, toast, onUpdate]);

  const addWitness = useCallback(async () => {
    if (!canInvestigate || !witnessName.trim()) return;
    setAddingWitness(true);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/investigation`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addedWitnesses: [
            {
              name: witnessName.trim(),
              phone: witnessPhone.trim() || null,
              statement: witnessStatement.trim() || null,
              addedAt: new Date().toISOString(),
            },
          ],
        }),
      });
      if (!res.ok) throw new Error('Failed to add witness');
      setWitnessName('');
      setWitnessPhone('');
      setWitnessStatement('');
      toast({ title: 'Witness added', variant: 'success' });
      onUpdate();
    } catch {
      toast({ title: 'Error', description: 'Failed to add witness', variant: 'error' });
    } finally {
      setAddingWitness(false);
    }
  }, [canInvestigate, incidentId, witnessName, witnessPhone, witnessStatement, toast, onUpdate]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Search className="h-4 w-4" />
          Investigation
          <Badge variant={STATUS_BADGE[status]} size="sm">
            {STATUS_LABELS[status]}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label className="text-sm font-medium">Accident Report Number</Label>
          <Input
            value={reportNumber}
            onChange={(e) => setReportNumber(e.target.value)}
            placeholder="MVAR-2026-00001"
            disabled={isReadOnly}
          />
        </div>

        <div className="space-y-1">
          <Label className="text-sm font-medium">Status</Label>
          <StyledSelect
            value={status}
            onChange={(e) => setStatus(e.target.value as InvestigationStatus)}
            disabled={isReadOnly}
          >
            {(isClosed ? INVESTIGATION_STATUSES : EDITABLE_INVESTIGATION_STATUSES).map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </StyledSelect>
          {!isClosed && canInvestigate ? (
            <p className="text-ink-500 text-xs">
              Final closure is a separate governed action and is not performed from the status selector.
            </p>
          ) : null}
        </div>

        <div className="space-y-1">
          <Label className="text-sm font-medium">Investigation Notes</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Document findings, evidence reviewed, root cause..."
            rows={4}
            disabled={isReadOnly}
          />
        </div>

        {!isClosed && (
          <div className="flex flex-wrap justify-end gap-2">
            {canInvestigate ? (
              <Button
                variant="primary"
                size="compact"
                onClick={() => void saveInvestigation(status)}
                disabled={saving}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                Save investigation
              </Button>
            ) : null}
            {!closeCapabilityResolved ? (
              <Button size="compact" variant="secondary" disabled>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                Checking close access
              </Button>
            ) : canCloseInvestigation ? (
              <Button
                size="compact"
                variant="secondary"
                onClick={() => setConfirmCloseOpen(true)}
                disabled={saving || !notes.trim()}
              >
                <CheckCircle2 className="mr-1 h-4 w-4" />
                Close investigation
              </Button>
            ) : canInvestigate ? (
              <span className="text-ink-500 inline-flex items-center gap-1 text-xs">
                <LockKeyhole className="h-3.5 w-3.5" />
                Closure requires an authorised closing officer.
              </span>
            ) : null}
          </div>
        )}

        {!isClosed && canCloseInvestigation && !notes.trim() ? (
          <p className="text-ink-500 text-xs">
            Investigation findings must be recorded before an authorised closing officer can close the case.
          </p>
        ) : null}

        {isClosed && (
          <div className="rounded-lg bg-muted p-3 text-sm text-ink-500 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-status-success-text" />
            Investigation closed at{' '}
            {data.investigationClosedAt
              ? new Date(data.investigationClosedAt).toLocaleDateString()
              : 'unknown time'}
          </div>
        )}

        <div className="border-t border-border pt-4 mt-4">
          <h4 className="text-sm font-semibold text-ink-700 mb-3">
            Witness Statements ({witnesses.length})
          </h4>

          {witnesses.map((w, i) => (
            <div
              key={String(i)}
              className="rounded-lg border border-border bg-surface-hover p-3 mb-2"
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <FileText className="h-3.5 w-3.5 text-ink-400" />
                {(w as Record<string, unknown>).name as string || `Witness ${i + 1}`}
              </div>
              {(w as Record<string, unknown>).phone ? (
                <p className="text-xs text-ink-500 mt-1">
                  Phone: {(w as Record<string, unknown>).phone as string}
                </p>
              ) : null}
              {(w as Record<string, unknown>).statement ? (
                <p className="text-xs text-ink-600 mt-1 italic">
                  {(w as Record<string, unknown>).statement as string}
                </p>
              ) : null}
            </div>
          ))}

          {!isClosed && canInvestigate && (
            <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
              <Input
                value={witnessName}
                onChange={(e) => setWitnessName(e.target.value)}
                placeholder="Witness name"
              />
              <Input
                value={witnessPhone}
                onChange={(e) => setWitnessPhone(e.target.value)}
                placeholder="Phone number (optional)"
              />
              <Textarea
                value={witnessStatement}
                onChange={(e) => setWitnessStatement(e.target.value)}
                placeholder="Statement (optional)"
                rows={2}
              />
              <Button
                size="compact"
                variant="secondary"
                onClick={addWitness}
                disabled={!witnessName.trim() || addingWitness}
              >
                {addingWitness ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Plus className="h-4 w-4 mr-1" />
                )}
                Add witness
              </Button>
            </div>
          )}
        </div>
      </CardContent>

      {canCloseInvestigation ? (
        <ConfirmDialog
          open={confirmCloseOpen}
          onOpenChange={setConfirmCloseOpen}
          title="Close investigation?"
          description="This is a final investigation decision. Closed incident evidence cannot be reopened through ordinary investigation editing, and vehicle-safety incidents must already have technical clearance."
          confirmLabel="Close investigation"
          onConfirm={() => saveInvestigation('closed')}
        />
      ) : null}
    </Card>
  );
}
