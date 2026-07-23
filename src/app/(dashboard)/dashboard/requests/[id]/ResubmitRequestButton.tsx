'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RotateCcw } from 'lucide-react';
import { useToast } from '@/lib/use-toast';

export function ResubmitRequestButton({ requestId }: { requestId: string }) {
  const router = useRouter(); const { toast } = useToast(); const [open, setOpen] = useState(false); const [reason, setReason] = useState(''); const [saving, setSaving] = useState(false);
  async function submit() { setSaving(true); try { const response = await fetch(`/api/requests/${requestId}/resubmit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Unable to resubmit'); toast({ title: 'Request resubmitted', description: `Revision ${result.revision} is awaiting supervisor review.`, variant: 'success' }); setOpen(false); router.refresh(); } catch (error) { toast({ title: 'Resubmission failed', description: error instanceof Error ? error.message : 'Unable to resubmit', variant: 'error' }); } finally { setSaving(false); } }
  return <><Button variant="primary" size="sm" onClick={() => setOpen(true)}><RotateCcw className="h-4 w-4" /> Resubmit</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Resubmit corrected request</DialogTitle></DialogHeader><textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} placeholder="Summarise the corrections made..." className="w-full rounded-[8px] border border-border p-3 text-sm" /><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={submit} loading={saving} disabled={!reason.trim()}>Resubmit</Button></div></DialogContent></Dialog></>;
}
