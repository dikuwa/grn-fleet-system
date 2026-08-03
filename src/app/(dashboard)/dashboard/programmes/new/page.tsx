'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { StyledDateInput } from '@/components/ui/styled-select';
import { useToast } from '@/lib/use-toast';
import { ArrowLeft, Loader2, Plus, XCircle } from 'lucide-react';
import Link from 'next/link';

export default function NewProgrammePage() {
  const router = useRouter();
  const { toast } = useToast();

  const [form, setForm] = useState({
    title: '',
    description: '',
    purpose: '',
    department: '',
    ownerEmployeeId: '',
    startDate: '',
    endDate: '',
    venue: '',
    region: '',
    expectedParticipants: '',
    plannedActivities: '',
    estimatedTravelRequirement: '',
    estimatedKilometres: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.startDate) {
      setError('A title and start date are required.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/programmes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          purpose: form.purpose.trim() || undefined,
          department: form.department.trim() || undefined,
          ownerEmployeeId: form.ownerEmployeeId.trim() || undefined,
          startDate: form.startDate,
          endDate: form.endDate || undefined,
          venue: form.venue.trim() || undefined,
          region: form.region.trim() || undefined,
          expectedParticipants: form.expectedParticipants
            ? Number(form.expectedParticipants)
            : undefined,
          plannedActivities: form.plannedActivities.trim() || undefined,
          estimatedTravelRequirement: form.estimatedTravelRequirement.trim() || undefined,
          estimatedKilometres: form.estimatedKilometres
            ? Number(form.estimatedKilometres)
            : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create programme');
      toast({
        title: 'Programme Created',
        description: `${json.data?.reference} saved as a draft.`,
        variant: 'success',
      });
      router.push(`/dashboard/programmes/${json.data?.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create programme';
      setError(msg);
      toast({ title: 'Creation Failed', description: msg, variant: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Programmes', href: '/dashboard/programmes' },
          { label: 'New Programme' },
        ]}
      />
      <PageHeader
        title="New Programme"
        description="Create a draft programme of activities. Submit it for review and publish it before linking it to transport requests."
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/programmes">
            <ArrowLeft className="h-4 w-4" /> Back to Programmes
          </Link>
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="pt-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label required>Programme Title</Label>
              <Input
                placeholder="e.g. Regional Development Workshop — Kavango East"
                value={form.title}
                onChange={set('title')}
                className="h-11"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <textarea
                className="border-border bg-surface text-ink-950 placeholder:text-ink-400 focus:ring-brand-600 min-h-[90px] w-full resize-y rounded-[8px] border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
                placeholder="Objectives, expected outcomes, and context…"
                value={form.description}
                onChange={set('description')}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Purpose / Travel Requirement</Label>
              <textarea
                className="border-border bg-surface text-ink-950 placeholder:text-ink-400 focus:ring-brand-600 min-h-[60px] w-full resize-y rounded-[8px] border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
                placeholder="Why transport is needed for this programme…"
                value={form.purpose}
                onChange={set('purpose')}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Department</Label>
                <Input
                  placeholder="e.g. Community Development"
                  value={form.department}
                  onChange={set('department')}
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Venue / Location</Label>
                <Input
                  placeholder="e.g. Rundu Town Hall"
                  value={form.venue}
                  onChange={set('venue')}
                  className="h-11"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label required>Start Date</Label>
                <StyledDateInput type="date" value={form.startDate} onChange={set('startDate')} />
              </div>
              <div className="space-y-1.5">
                <Label>End Date</Label>
                <StyledDateInput type="date" value={form.endDate} onChange={set('endDate')} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Region</Label>
                <Input placeholder="e.g. Kavango East" value={form.region} onChange={set('region')} className="h-11" />
              </div>
              <div className="space-y-1.5">
                <Label>Expected Participants</Label>
                <Input
                  type="number"
                  min={0}
                  placeholder="e.g. 40"
                  value={form.expectedParticipants}
                  onChange={set('expectedParticipants')}
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Est. Kilometres</Label>
                <Input
                  type="number"
                  min={0}
                  placeholder="e.g. 250"
                  value={form.estimatedKilometres}
                  onChange={set('estimatedKilometres')}
                  className="h-11"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Planned Activities</Label>
              <textarea
                className="border-border bg-surface text-ink-950 placeholder:text-ink-400 focus:ring-brand-600 min-h-[70px] w-full resize-y rounded-[8px] border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
                placeholder="Breakdown of planned activities and sessions…"
                value={form.plannedActivities}
                onChange={set('plannedActivities')}
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-[8px] border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800/40 dark:bg-red-950/20 dark:text-red-300">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" size="sm" type="button" asChild>
                <Link href="/dashboard/programmes">Cancel</Link>
              </Button>
              <Button
                variant="primary"
                size="sm"
                type="submit"
                loading={isSubmitting}
                disabled={!form.title.trim() || !form.startDate || isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Save Draft
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
