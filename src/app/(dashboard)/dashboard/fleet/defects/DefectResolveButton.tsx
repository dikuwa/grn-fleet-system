'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';

interface DefectResolveButtonProps {
  defectId: string;
  onResolved?: () => void;
}

export function DefectResolveButton({ defectId, onResolved }: DefectResolveButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [releaseBlockers, setReleaseBlockers] = useState<string[]>([]);

  const closeDialog = useCallback(() => {
    if (resolving) return;
    setOpen(false);
    setError(null);
    setSuccessMessage(null);
    setReleaseBlockers([]);
    setNotes('');
  }, [resolving]);

  const handleResolve = useCallback(async () => {
    if (!notes.trim() || resolving) return;
    setResolving(true);
    setError(null);
    setReleaseBlockers([]);
    try {
      const res = await fetch(`/api/defects/${defectId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolutionNotes: notes.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to resolve defect');

      const blockers = Array.isArray(json.releaseBlockers)
        ? json.releaseBlockers.filter((value: unknown): value is string => typeof value === 'string' && Boolean(value.trim()))
        : [];
      setReleaseBlockers(blockers);
      setSuccessMessage(
        json.vehicleReleased
          ? 'Defect resolved. All operational safety gates are clear, so the vehicle was returned to available status.'
          : json.alreadyResolved
            ? 'This defect was already resolved. The list has been refreshed.'
            : 'Defect resolved. The vehicle remains restricted until the outstanding operational or safety gates below are cleared.',
      );
      onResolved?.();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve defect');
    } finally {
      setResolving(false);
    }
  }, [defectId, notes, onResolved, resolving, router]);

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          role="presentation"
          onClick={closeDialog}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`resolve-defect-${defectId}`}
            className="mx-4 w-full max-w-md rounded-[12px] border border-border bg-surface p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 id={`resolve-defect-${defectId}`} className="text-lg font-semibold text-ink-950">Resolve Defect</h3>
              {!resolving && (
                <button type="button" aria-label="Close resolution dialog" onClick={closeDialog} className="focus-ring cursor-pointer rounded text-ink-400 hover:text-ink-700">
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>

            {successMessage ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-[8px] border border-status-success-bg bg-status-success-bg/20 px-4 py-3">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-status-success-text" />
                  <p className="text-sm font-medium text-status-success-text">{successMessage}</p>
                </div>
                {releaseBlockers.length > 0 && (
                  <div className="rounded-[8px] border border-status-warning-bg bg-status-warning-bg/15 px-4 py-3">
                    <div className="flex items-center gap-2 text-status-warning-text">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <p className="text-sm font-semibold">Vehicle still restricted</p>
                    </div>
                    <ul className="text-ink-700 mt-2 space-y-1.5 pl-5 text-xs">
                      {releaseBlockers.map((blocker) => <li key={blocker} className="list-disc">{blocker}</li>)}
                    </ul>
                  </div>
                )}
                <div className="flex justify-end">
                  <Button variant="primary" size="sm" onClick={closeDialog}>Done</Button>
                </div>
              </div>
            ) : (
              <>
                <p className="mb-4 text-sm text-ink-500">
                  Describe the repair, test or corrective action that cleared this defect. Resolving one item does not make a vehicle allocatable while another defect, active trip or MVA technical-clearance gate remains.
                </p>

                <Input
                  placeholder="e.g. Replaced brake pads and road-tested"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mb-3"
                  autoFocus
                />

                {error && <p className="mb-3 text-xs text-status-error-text">{error}</p>}

                <div className="flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={closeDialog} disabled={resolving}>Cancel</Button>
                  <Button variant="primary" size="sm" onClick={handleResolve} loading={resolving} disabled={!notes.trim() || resolving}>
                    {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Mark Resolved
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
