'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle2 } from 'lucide-react';
import { useToast } from '@/lib/use-toast';

interface Props {
  documentId: string;
  currentStatus: string;
}

/**
 * Generated versions move to superseded automatically when a newer draft is
 * formally issued. There is deliberately no standalone "Supersede" button:
 * removing the current official version without a replacement would leave the
 * record family with no authoritative document.
 */
export function DocumentLifecycleActions({ documentId, currentStatus }: Props) {
  const [isIssuing, setIsIssuing] = useState(false);
  const { toast } = useToast();

  const issueDocument = useCallback(async () => {
    setIsIssuing(true);

    try {
      const res = await fetch(`/api/documents/${documentId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'issue' }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast({
          title: 'Issue failed',
          description: data.error || 'The document could not be issued.',
          variant: 'error',
        });
        return;
      }

      toast({
        title: 'Document issued',
        description: 'This version is now the current official document.',
        variant: 'success',
      });
      window.setTimeout(() => window.location.reload(), 600);
    } catch (error) {
      toast({
        title: 'Issue failed',
        description: error instanceof Error ? error.message : 'The document could not be issued.',
        variant: 'error',
      });
    } finally {
      setIsIssuing(false);
    }
  }, [documentId, toast]);

  if (currentStatus !== 'draft') return null;

  return (
    <Button
      variant="primary"
      size="sm"
      onClick={issueDocument}
      loading={isIssuing}
    >
      <CheckCircle2 className="h-4 w-4" />
      {isIssuing ? 'Issuing...' : 'Issue'}
    </Button>
  );
}
