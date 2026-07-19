'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Truck } from 'lucide-react';

interface AllocationActionsProps {
  allocationId: string;
  requestId: string;
  vehicleId: string;
  hasTrip: boolean;
}

export function AllocationActions({ allocationId, requestId, vehicleId, hasTrip }: AllocationActionsProps) {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const handleCreateTrip = useCallback(async () => {
    setIsCreating(true);
    setError('');
    try {
      // First confirm the allocation (if provisional)
      const confirmRes = await fetch(`/api/allocations/${allocationId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionType: 'confirm' }),
      });
      if (!confirmRes.ok) {
        const confirmData = await confirmRes.json();
        throw new Error(confirmData.error || 'Failed to confirm allocation');
      }

      // Create the trip
      const tripRes = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allocationId,
          requestId,
          vehicleId,
        }),
      });
      const tripData = await tripRes.json();
      if (!tripRes.ok) throw new Error(tripData.error || 'Failed to create trip');

      router.push(`/dashboard/trips/${tripData.trip.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create trip');
    } finally {
      setIsCreating(false);
    }
  }, [allocationId, requestId, vehicleId, router]);

  if (hasTrip) return null;

  return (
    <div>
      <Button variant="primary" size="sm" loading={isCreating} onClick={handleCreateTrip}>
        <Truck className="h-4 w-4" /> Create Trip
      </Button>
      {error && <p className="mt-1 text-xs text-status-error-text">{error}</p>}
    </div>
  );
}
