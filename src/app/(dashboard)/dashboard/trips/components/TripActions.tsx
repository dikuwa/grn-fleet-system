'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Play, RotateCcw, CheckSquare } from 'lucide-react';
import Link from 'next/link';

interface TripActionsProps {
  tripId: string;
  status: string;
  tenantId: string;
}

export function TripActions({ tripId, status }: TripActionsProps) {
  const router = useRouter();
  const [isWorking, setIsWorking] = useState(false);

  const handleAction = useCallback(async (action: string) => {
    setIsWorking(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to ${action} trip`);
      }
      router.refresh();
    } catch (err) {
      console.error(`Trip ${action} failed:`, err);
      alert(err instanceof Error ? err.message : `Failed to ${action} trip`);
    } finally {
      setIsWorking(false);
    }
  }, [tripId, router]);

  if (status === 'pending') {
    return (
      <Button variant="primary" size="sm" loading={isWorking} onClick={() => handleAction('start')}>
        <Play className="h-4 w-4" /> Start Trip
      </Button>
    );
  }

  if (status === 'in_progress') {
    return (
      <Button variant="primary" size="sm" loading={isWorking} onClick={() => handleAction('return')}>
        <RotateCcw className="h-4 w-4" /> Mark Returned
      </Button>
    );
  }

  if (status === 'return_inspection' || status === 'closure_review') {
    return (
      <Button variant="secondary" size="sm" asChild>
        <Link href={`/dashboard/inspections/return`}>
          <CheckSquare className="h-4 w-4" /> Complete Return Inspection
        </Link>
      </Button>
    );
  }

  return null;
}
