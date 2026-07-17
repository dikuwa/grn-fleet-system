'use client';

import { useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea, Label } from '@/components/ui/input';
import { ChevronLeft, CheckCircle2, XCircle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function ApprovalActionPage() {
  const params = useParams();
  const router = useRouter();
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleAction = useCallback(async (actionType: string) => {
    setIsSubmitting(true);
    setError('');
    try {
      const res = await fetch(`/api/approvals/${params.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionType,
          comment: comment || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Action failed');
      }

      router.push(`/dashboard/approvals/${params.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      setIsSubmitting(false);
    }
  }, [params.id, router, comment]);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Approvals', href: '/dashboard/approvals' },
        { label: 'Take Action' },
      ]} />
      <PageHeader title="Take Action" description="Review and respond to this approval request">
        <Button variant="secondary" size="sm" asChild>
          <Link href={`/dashboard/approvals/${params.id}`}><ChevronLeft className="h-4 w-4" /> Back</Link>
        </Button>
      </PageHeader>

      <Card>
        <CardHeader><CardTitle>Your Decision</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-1.5">
            <Label>Comment</Label>
            <Textarea
              placeholder="Add a comment explaining your decision..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
            />
            <p className="text-xs text-ink-500">Comments are recorded in the workflow history.</p>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-medium text-ink-500 uppercase tracking-wider">Choose Action</p>
            <button
              onClick={() => handleAction('approved')}
              disabled={isSubmitting}
              className="w-full flex items-center gap-3 rounded-[10px] border border-status-success-bg bg-status-success-bg/30 p-4 text-left transition-all hover:bg-status-success-bg/50 disabled:opacity-50"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-status-success-bg text-status-success-text">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-status-success-text">Approve</p>
                <p className="text-xs text-ink-500">Approve this request and advance to the next workflow step.</p>
              </div>
            </button>

            <button
              onClick={() => handleAction('returned')}
              disabled={isSubmitting}
              className="w-full flex items-center gap-3 rounded-[10px] border border-status-pending-bg bg-status-pending-bg/30 p-4 text-left transition-all hover:bg-status-pending-bg/50 disabled:opacity-50"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-status-pending-bg text-status-pending-text">
                <ArrowLeft className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-status-pending-text">Return for Changes</p>
                <p className="text-xs text-ink-500">Send the request back to the requester for modifications.</p>
              </div>
            </button>

            <button
              onClick={() => handleAction('rejected')}
              disabled={isSubmitting}
              className="w-full flex items-center gap-3 rounded-[10px] border border-status-error-bg bg-status-error-bg/30 p-4 text-left transition-all hover:bg-status-error-bg/50 disabled:opacity-50"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-status-error-bg text-status-error-text">
                <XCircle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-status-error-text">Reject</p>
                <p className="text-xs text-ink-500">Deny this request. The workflow will be cancelled.</p>
              </div>
            </button>
          </div>

          {error && (
            <div className="rounded-[8px] border border-status-error-bg bg-status-error-bg/20 px-4 py-3">
              <p className="text-sm font-medium text-status-error-text">{error}</p>
            </div>
          )}

          {isSubmitting && (
            <div className="flex items-center gap-2 rounded-[8px] bg-status-info-bg px-4 py-3">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-700 border-t-transparent" />
              <span className="text-sm text-ink-700">Processing your decision...</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
