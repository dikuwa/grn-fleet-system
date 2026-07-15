'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle2, FileSymlink } from 'lucide-react';

interface Props {
  documentId: string;
  currentStatus: string;
}

export function DocumentLifecycleActions({ documentId, currentStatus }: Props) {
  const [action, setAction] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

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
        setToast({ type: 'error', message: data.error || 'Action failed' });
        setTimeout(() => setToast(null), 4000);
        return;
      }

      setToast({ type: 'success', message: act === 'issue' ? 'Document issued' : 'Document superseded' });
      // Reload to show updated status
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      setToast({ type: 'error', message: err instanceof Error ? err.message : 'Action failed' });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setAction(null);
    }
  }, [documentId]);

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
      {toast && (
        <div
          className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-medium shadow-lg transition-all ${
            toast.type === 'success'
              ? 'bg-green-600 text-white'
              : 'bg-status-error-text text-white'
          }`}
        >
          {toast.message}
        </div>
      )}
    </>
  );
}
