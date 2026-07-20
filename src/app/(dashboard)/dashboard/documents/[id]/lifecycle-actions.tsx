'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle2, FileSymlink } from 'lucide-react';
import { useToast } from '@/lib/use-toast';

interface Props {
  documentId: string;
  currentStatus: string;
}

export function DocumentLifecycleActions({ documentId, currentStatus }: Props) {
  const [action, setAction] = useState<string | null>(null);
  const { toast } = useToast();

  const handleAction = useCallback(async (act: 'issue' | 'supersede') => {
    setAction(act);

    try {
      const res = await fetch(`/api/documents/${documentId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: act }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast({ title: 'Action Failed', description: data.error || 'Action failed', variant: 'error' });
        setAction(null);
        return;
      }

      toast({ title: act === 'issue' ? 'Document Issued' : 'Document Superseded', description: `Document has been ${act}d.`, variant: 'success' });
      // Reload to show updated status
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      toast({ title: 'Action Failed', description: err instanceof Error ? err.message : 'Action failed', variant: 'error' });
    } finally {
      setAction(null);
    }
  }, [documentId, toast]);

  if (currentStatus === 'superseded') return null;

  return (
    <>
      {currentStatus !== 'issued' && (
        <Button
          variant="primary"
          size="sm"
          onClick={() => handleAction('issue')}
          loading={action === 'issue'}
        >
          <CheckCircle2 className="h-4 w-4" />
          {action === 'issue' ? 'Issuing...' : 'Issue'}
        </Button>
      )}
      {currentStatus === 'issued' && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => handleAction('supersede')}
          loading={action === 'supersede'}
        >
          <FileSymlink className="h-4 w-4" />
          {action === 'supersede' ? 'Superseding...' : 'Supersede'}
        </Button>
      )}
    </>
  );
}
