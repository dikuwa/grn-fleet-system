'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { StyledDateInput } from '@/components/ui/styled-select';
import { useToast } from '@/lib/use-toast';
import { Camera, Loader2 } from 'lucide-react';

export function LicenceUploadPanel({ employeeId }: { employeeId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  async function upload(formData: FormData) {
    setBusy(true);
    try {
      const response = await fetch(`/api/drivers/${employeeId}/licences`, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        toast({
          title: 'Licence upload failed',
          description: data.error,
          variant: 'error',
        });
        return;
      }

      toast({
        title: data.manualEntryRequired ? 'Licence saved for manual review' : 'OCR complete',
        description: data.qualityWarnings?.length
          ? `Warnings: ${data.qualityWarnings.join(', ').replaceAll('_', ' ')}`
          : 'Review extracted fields before verification.',
        variant: data.qualityWarnings?.length ? 'pending' : 'success',
      });
      setOpen(false);

      // router.refresh() updates server-rendered staff screens, but Driver Self-Service
      // owns its licence list in client state. A successful renewal must be immediately
      // visible there too, otherwise a real upload looks stale until the user manually
      // reloads the page. Preserve router.refresh() for server components and perform a
      // location reload when running in the browser so all client-side licence state is
      // rebuilt from /api/drivers/me.
      router.refresh();
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    } catch (error) {
      toast({
        title: 'Licence upload failed',
        description: error instanceof Error ? error.message : 'Unable to upload the licence.',
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Button size="sm" variant="secondary" onClick={() => setOpen((value) => !value)}>
        <Camera className="h-4 w-4" />
        Upload renewed licence
      </Button>
      {open && (
        <form action={upload} className="mt-4 space-y-4 rounded-[8px] border border-border bg-canvas p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5">
              <Label required>Front image</Label>
              <Input name="front" type="file" accept="image/*" capture="environment" required />
            </label>
            <label className="space-y-1.5">
              <Label required>Back image</Label>
              <Input name="back" type="file" accept="image/*" capture="environment" required />
            </label>
            <div className="space-y-1.5">
              <Label>Licence number fallback</Label>
              <Input name="licenceNumber" />
            </div>
            <div className="space-y-1.5">
              <Label>Licence codes fallback</Label>
              <Input name="licenceClass" placeholder="B, C1" />
            </div>
            <div className="space-y-1.5">
              <Label>Valid from fallback</Label>
              <StyledDateInput name="issueDate" type="date" />
            </div>
            <div className="space-y-1.5">
              <Label>Valid until fallback</Label>
              <StyledDateInput name="expiryDate" type="date" />
            </div>
          </div>
          <p className="text-xs text-ink-500">
            Original files are preserved. OCR suggestions remain unverified until an authorised reviewer confirms them.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Upload and run OCR
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
