'use client';

import { useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/input';
import { useToast } from '@/lib/use-toast';
import Link from 'next/link';
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Gauge,
  Loader2,
  MapPin,
  Pencil,
  Send,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react';

interface Programme {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  purpose: string | null;
  department: string | null;
  status: string;
  venue: string | null;
  region: string | null;
  startDate: string | null;
  endDate: string | null;
  expectedParticipants: number | null;
  plannedActivities: string | null;
  estimatedTravelRequirement: string | null;
  estimatedKilometres: number | null;
  reviewNotes: string | null;
  rejectionReason: string | null;
  ownerFirstName: string | null;
  ownerLastName: string | null;
  ownerJobTitle: string | null;
  ownerEmail: string | null;
  departmentName: string | null;
  officeName: string | null;
  regionName: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface LinkedRequest {
  id: string;
  reference: string;
  status: string;
  purpose: string | null;
  createdAt: string;
}

interface ProgrammeCapabilities {
  canEdit: boolean;
  canDelete: boolean;
  allowedActions: string[];
}

const STATUS_VARIANT: Record<string, 'success' | 'pending' | 'info' | 'error' | 'cancelled'> = {
  draft: 'pending',
  submitted: 'info',
  changes_requested: 'pending',
  approved: 'success',
  published: 'success',
  rejected: 'error',
  archived: 'cancelled',
  completed: 'success',
};

const ACTIONS_BY_STATUS: Record<string, { action: string; label: string; variant: 'primary' | 'secondary' | 'destructive' }[]> = {
  draft: [
    { action: 'submit', label: 'Submit for Review', variant: 'primary' },
    { action: 'archive', label: 'Archive', variant: 'secondary' },
  ],
  changes_requested: [
    { action: 'submit', label: 'Resubmit', variant: 'primary' },
    { action: 'archive', label: 'Archive', variant: 'secondary' },
  ],
  submitted: [
    { action: 'approve', label: 'Approve', variant: 'primary' },
    { action: 'request_changes', label: 'Request Changes', variant: 'secondary' },
    { action: 'reject', label: 'Reject', variant: 'destructive' },
  ],
  approved: [
    { action: 'publish', label: 'Publish', variant: 'primary' },
    { action: 'archive', label: 'Archive', variant: 'secondary' },
  ],
  published: [
    { action: 'complete', label: 'Mark Completed', variant: 'secondary' },
    { action: 'archive', label: 'Archive', variant: 'secondary' },
  ],
  completed: [{ action: 'archive', label: 'Archive', variant: 'secondary' }],
};

const ACTION_LABEL: Record<string, string> = {
  submit: 'Submit for Review',
  request_changes: 'Request Changes',
  approve: 'Approve',
  reject: 'Reject',
  publish: 'Publish',
  archive: 'Archive',
  complete: 'Mark Completed',
};

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-NA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function ProgrammeDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const id = params.id;

  const [actionDialog, setActionDialog] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [isWorking, setIsWorking] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['programme', id],
    queryFn: async () => {
      const res = await fetch(`/api/programmes/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load programme');
      return json;
    },
    enabled: Boolean(id),
  });

  const programme: Programme | undefined = data?.data?.programme;
  const linkedRequests: LinkedRequest[] = data?.data?.linkedRequests || [];
  const capabilities: ProgrammeCapabilities = data?.data?.capabilities || {
    canEdit: false,
    canDelete: false,
    allowedActions: [],
  };

  const openAction = useCallback((action: string) => {
    setNote('');
    setActionDialog(action);
  }, []);

  const runAction = useCallback(
    async (action: string) => {
      setIsWorking(true);
      try {
        const res = await fetch(`/api/programmes/${id}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, note: note.trim() || undefined }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Action failed');
        setActionDialog(null);
        toast({
          title: 'Programme Updated',
          description: `${programme?.reference} — ${ACTION_LABEL[action] ?? action}.`,
          variant: 'success',
        });
        queryClient.invalidateQueries({ queryKey: ['programme', id] });
        queryClient.invalidateQueries({ queryKey: ['programmes'] });
      } catch (err) {
        toast({
          title: 'Action Failed',
          description: err instanceof Error ? err.message : 'Could not process the action.',
          variant: 'error',
        });
      } finally {
        setIsWorking(false);
      }
    },
    [id, note, programme, queryClient, toast],
  );

  const deleteDraft = useCallback(async () => {
    if (!window.confirm('Delete this draft programme? This cannot be undone.')) return;
    setIsWorking(true);
    try {
      const res = await fetch(`/api/programmes/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Delete failed');
      toast({ title: 'Programme Deleted', description: 'Draft programme removed.', variant: 'success' });
      router.push('/dashboard/programmes');
    } catch (err) {
      toast({
        title: 'Delete Failed',
        description: err instanceof Error ? err.message : 'Could not delete the programme.',
        variant: 'error',
      });
    } finally {
      setIsWorking(false);
    }
  }, [id, router, toast]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-ink-400" />
      </div>
    );
  }

  if (error || !programme) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Programmes', href: '/dashboard/programmes' }]} />
        <EmptyState
          icon={<FileText className="h-8 w-8" />}
          title="Programme not found"
          description={error instanceof Error ? error.message : 'This programme does not exist or you do not have access to it.'}
          action={{ label: 'Back to Programmes', href: '/dashboard/programmes' }}
        />
      </div>
    );
  }

  const allowedActionSet = new Set(capabilities.allowedActions);
  const actions = (ACTIONS_BY_STATUS[programme.status] || []).filter((item) => allowedActionSet.has(item.action));
  const requiresNote = actionDialog === 'request_changes' || actionDialog === 'reject';

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Programmes', href: '/dashboard/programmes' },
          { label: programme.reference },
        ]}
      />
      <PageHeader
        title={programme.title}
        description={`${programme.reference} · created ${formatDate(programme.createdAt)}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/programmes">
              <ArrowLeft className="h-4 w-4" /> Back
            </Link>
          </Button>
          {capabilities.canEdit && (
            <Button variant="secondary" size="sm" asChild>
              <Link href={`/dashboard/programmes/${id}/edit`}>
                <Pencil className="h-4 w-4" /> Edit
              </Link>
            </Button>
          )}
          {capabilities.canDelete && (
            <Button variant="destructive" size="sm" onClick={deleteDraft} loading={isWorking}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          )}
          {actions.map((a) => (
            <Button
              key={a.action}
              variant={a.variant}
              size="sm"
              onClick={() => openAction(a.action)}
            >
              {a.action === 'submit' || a.action === 'publish' ? (
                <Send className="h-4 w-4" />
              ) : a.action === 'approve' ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : a.action === 'reject' ? (
                <XCircle className="h-4 w-4" />
              ) : (
                <ClipboardCheck className="h-4 w-4" />
              )}
              {a.label}
            </Button>
          ))}
        </div>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Programme Details
                <Badge variant={STATUS_VARIANT[programme.status] ?? 'info'}>
                  {programme.status.replace(/_/g, ' ')}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {programme.description && <p className="text-ink-700 text-sm">{programme.description}</p>}
              {programme.purpose && (
                <div>
                  <p className="text-ink-500 mb-1 text-xs font-medium uppercase tracking-wider">Purpose / Travel Requirement</p>
                  <p className="text-ink-700 text-sm">{programme.purpose}</p>
                </div>
              )}
              {programme.plannedActivities && (
                <div>
                  <p className="text-ink-500 mb-1 text-xs font-medium uppercase tracking-wider">Planned Activities</p>
                  <p className="text-ink-700 text-sm whitespace-pre-line">{programme.plannedActivities}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div className="rounded-[8px] bg-muted p-3">
                  <p className="text-[11px] text-ink-500 uppercase tracking-wider">Start</p>
                  <p className="text-ink-950 mt-0.5 flex items-center gap-1.5 text-sm font-medium">
                    <CalendarDays className="h-4 w-4 text-ink-400" /> {formatDate(programme.startDate)}
                  </p>
                </div>
                <div className="rounded-[8px] bg-muted p-3">
                  <p className="text-[11px] text-ink-500 uppercase tracking-wider">End</p>
                  <p className="text-ink-950 mt-0.5 flex items-center gap-1.5 text-sm font-medium">
                    <CalendarDays className="h-4 w-4 text-ink-400" /> {formatDate(programme.endDate)}
                  </p>
                </div>
                <div className="rounded-[8px] bg-muted p-3">
                  <p className="text-[11px] text-ink-500 uppercase tracking-wider">Venue</p>
                  <p className="text-ink-950 mt-0.5 flex items-center gap-1.5 text-sm font-medium">
                    <MapPin className="h-4 w-4 text-ink-400" /> {programme.venue || '—'}
                  </p>
                </div>
                <div className="rounded-[8px] bg-muted p-3">
                  <p className="text-[11px] text-ink-500 uppercase tracking-wider">Participants</p>
                  <p className="text-ink-950 mt-0.5 flex items-center gap-1.5 text-sm font-medium">
                    <Users className="h-4 w-4 text-ink-400" /> {programme.expectedParticipants ?? '—'}
                  </p>
                </div>
                <div className="rounded-[8px] bg-muted p-3">
                  <p className="text-[11px] text-ink-500 uppercase tracking-wider">Est. Distance</p>
                  <p className="text-ink-950 mt-0.5 flex items-center gap-1.5 text-sm font-medium">
                    <Gauge className="h-4 w-4 text-ink-400" /> {programme.estimatedKilometres ? `${programme.estimatedKilometres} km` : '—'}
                  </p>
                </div>
                <div className="rounded-[8px] bg-muted p-3">
                  <p className="text-[11px] text-ink-500 uppercase tracking-wider">Department</p>
                  <p className="text-ink-950 mt-0.5 text-sm font-medium">{programme.departmentName || programme.department || '—'}</p>
                </div>
              </div>

              {programme.reviewNotes && (
                <div className="rounded-[8px] border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-200">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wider">Reviewer Notes</p>
                  {programme.reviewNotes}
                </div>
              )}
              {programme.rejectionReason && (
                <div className="rounded-[8px] border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800/40 dark:bg-red-950/20 dark:text-red-300">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wider">Rejection Reason</p>
                  {programme.rejectionReason}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Linked Transport Requests</CardTitle>
            </CardHeader>
            <CardContent>
              {linkedRequests.length === 0 ? (
                <p className="py-4 text-center text-xs text-ink-400">
                  No transport requests are linked to this programme yet. Published programmes can be selected when creating a transport request.
                </p>
              ) : (
                <div className="space-y-2">
                  {linkedRequests.map((r) => (
                    <Link
                      key={r.id}
                      href={`/dashboard/requests/${r.id}`}
                      className="border-border bg-surface hover:border-brand-100 flex items-center justify-between rounded-[8px] border px-4 py-3 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-ink-950 text-sm font-medium">{r.reference}</p>
                        <p className="text-ink-500 truncate text-xs">{r.purpose || '—'}</p>
                      </div>
                      <Badge variant={r.status === 'closed' ? 'success' : 'info'} size="sm">
                        {r.status.replace(/_/g, ' ')}
                      </Badge>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Ownership</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-ink-500 text-xs uppercase tracking-wider">Owner</p>
                <p className="text-ink-950 font-medium">
                  {[programme.ownerFirstName, programme.ownerLastName].filter(Boolean).join(' ') || '—'}
                </p>
                {programme.ownerJobTitle && <p className="text-ink-500 text-xs">{programme.ownerJobTitle}</p>}
              </div>
              {programme.officeName && (
                <div>
                  <p className="text-ink-500 text-xs uppercase tracking-wider">Office</p>
                  <p className="text-ink-950 font-medium">{programme.officeName}</p>
                </div>
              )}
              {(programme.regionName || programme.region) && (
                <div>
                  <p className="text-ink-500 text-xs uppercase tracking-wider">Region</p>
                  <p className="text-ink-950 font-medium">{programme.regionName || programme.region}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {[
                { label: 'Created', value: formatDate(programme.createdAt) },
                { label: 'Submitted', value: formatDate(programme.submittedAt) },
                { label: 'Reviewed', value: formatDate(programme.reviewedAt) },
                { label: 'Approved', value: formatDate(programme.approvedAt) },
                { label: 'Published', value: formatDate(programme.publishedAt) },
                { label: 'Archived', value: formatDate(programme.archivedAt) },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between">
                  <span className="text-ink-500">{row.label}</span>
                  <span className="text-ink-950 font-medium">{row.value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={Boolean(actionDialog)} onOpenChange={(open) => !open && setActionDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{actionDialog ? ACTION_LABEL[actionDialog] ?? 'Confirm Action' : ''}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {requiresNote && (
              <div className="space-y-1.5">
                <Label required>{actionDialog === 'reject' ? 'Rejection Reason' : 'What changes are required?'}</Label>
                <textarea
                  className="border-border bg-surface text-ink-950 placeholder:text-ink-400 focus:ring-brand-600 min-h-[90px] w-full resize-y rounded-[8px] border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
                  placeholder="Provide details for the programme creator…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            )}
            {actionDialog === 'submit' && <p className="text-ink-600 text-sm">Submitting sends this programme to an independent Tenant Administrator for review.</p>}
            {actionDialog === 'approve' && <p className="text-ink-600 text-sm">Approve this programme so it can be published and linked to transport requests.</p>}
            {actionDialog === 'publish' && <p className="text-ink-600 text-sm">Publishing makes this programme selectable when creating transport requests.</p>}
            {actionDialog === 'archive' && <p className="text-ink-600 text-sm">Archive this programme. Archived programmes are hidden from request creation.</p>}
            {actionDialog === 'complete' && <p className="text-ink-600 text-sm">Mark this programme as completed.</p>}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setActionDialog(null)}>Cancel</Button>
              <Button
                variant={actionDialog === 'reject' ? 'destructive' : 'primary'}
                size="sm"
                loading={isWorking}
                disabled={requiresNote && !note.trim()}
                onClick={() => actionDialog && runAction(actionDialog)}
              >
                {ACTION_LABEL[actionDialog ?? ''] ?? 'Confirm'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
