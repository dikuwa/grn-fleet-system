'use client';

import Link from 'next/link';
import { PencilLine } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ResubmitRequestButton({ requestId }: { requestId: string }) {
  return (
    <Button variant="primary" size="sm" asChild>
      <Link href={`/dashboard/requests/${requestId}/routing-correction`}>
        <PencilLine className="h-4 w-4" />
        Edit & Resubmit
      </Link>
    </Button>
  );
}
