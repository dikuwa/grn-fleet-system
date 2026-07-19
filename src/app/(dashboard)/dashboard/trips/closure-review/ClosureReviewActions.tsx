'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { CheckSquare, RotateCcw, Loader2, CheckCircle2, XCircle } from 'lucide-react';

interface ClosureReviewActionsProps {
  tripId: string;
  tripStatus: string;
  hasReturnInspection: boolean;
}

export function ClosureReviewActions({ tripId, tripStatus, hasReturnInspection }: ClosureReviewActionsProps) {
  const router = useRouter();
  const [isClosing, setIsClosing] = useState(false);
  const [actionResult, setActionResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleCloseTrip = async () => {
    setIsClosing(true);
    setActionResult(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'closed', reviewNotes: 'Closed from closure review dashboard' }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to close trip');

      setActionResult({ success: true, message: 'Trip closed successfully' });
      setTimeout(() => router.refresh(), 1500);
    } catch (err) {
      setActionResult({
        success: false,
        message: err instanceof Error ? err.message : 'Failed to close trip',
      });
    } finally {
      setIsClosing(false);
    }
  };

  const handleReturnInspection = () => {
    router.push(`/dashboard/inspections/return?tripId=${tripId}`);
  };

  if (actionResult?.success) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-green-700">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Closed
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {(tripStatus === 'closure_review' || hasReturnInspection) && (
        <Button
          variant="primary"
          size="sm"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleCloseTrip();
          }}
          loading={isClosing}
          className="h-7 px-2.5 text-[11px]"
        >
          <CheckSquare className="h-3 w-3" />
          Close
        </Button>
      )}
      {!hasReturnInspection && (
        <Button
          variant="secondary"
          size="sm"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleReturnInspection();
          }}
          className="h-7 px-2.5 text-[11px]"
        >
          <RotateCcw className="h-3 w-3" />
          Inspect
        </Button>
      )}
      {actionResult && !actionResult.success && (
        <span className="text-[10px] text-red-600">{actionResult.message}</span>
      )}
    </div>
  );
}
