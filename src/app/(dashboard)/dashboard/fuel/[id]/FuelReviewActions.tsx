'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/lib/use-toast';

export function FuelReviewActions({ transactionId }: { transactionId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  async function verify() {
    setSubmitting(true);
    try {
      const response = await fetch('/api/fuel', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId, action: 'verify' }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Fuel verification failed');
      toast({ title: 'Fuel transaction verified', variant: 'success' });
      router.refresh();
    } catch (error) {
      toast({
        title: 'Unable to verify fuel transaction',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Button size="sm" onClick={verify} loading={submitting}>
      <CheckCircle2 className="h-4 w-4" />
      Verify transaction
    </Button>
  );
}
