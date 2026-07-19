'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckCircle2, Loader2, X } from 'lucide-react';

interface DefectResolveButtonProps {
  defectId: string;
  onResolved?: () => void;
}

export function DefectResolveButton({ defectId, onResolved }: DefectResolveButtonProps) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleResolve = useCallback(async () => {
    if (!notes.trim()) return;
    setResolving(true);
    setError(null);
    try {
      const res = await fetch(`/api/defects/${defectId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolutionNotes: notes.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to resolve');
      setSuccess(true);
      setTimeout(() => {
        setOpen(false);
        setSuccess(false);
        setNotes('');
        onResolved?.();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve');
    } finally {
      setResolving(false);
    }
  }, [defectId, notes, onResolved]);

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => { if (!resolving) setOpen(false); }}
        >
          <div
            className="mx-4 w-full max-w-md rounded-[12px] border border-border bg-surface p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-ink-950">Resolve Defect</h3>
              {!resolving && (
                <button onClick={() => setOpen(false)} className="text-ink-400 hover:text-ink-700">
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>

            {success ? (
              <div className="flex items-center gap-3 rounded-[8px] border border-green-200 bg-green-50 px-4 py-3">
                <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                <p className="text-sm font-medium text-green-800">Defect resolved successfully!</p>
              </div>
            ) : (
              <>
                <p className="text-sm text-ink-500 mb-4">
                  Provide resolution notes describing how this defect was fixed.
                </p>

                <Input
                  placeholder="e.g. Replaced brake pads and tested"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mb-3"
                  autoFocus
                />

                {error && (
                  <p className="mb-3 text-xs text-status-error-text">{error}</p>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={resolving}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleResolve}
                    loading={resolving}
                    disabled={!notes.trim()}
                  >
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
