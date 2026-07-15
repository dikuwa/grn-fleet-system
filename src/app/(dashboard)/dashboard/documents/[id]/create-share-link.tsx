'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Link2, Copy, CheckCircle2 } from 'lucide-react';

interface Props {
  documentId: string;
}

export function CreateShareLinkButton({ documentId }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [expiresInHours, setExpiresInHours] = useState(168); // 7 days
  const [maxViews, setMaxViews] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const createLink = useCallback(async () => {
    setIsCreating(true);
    setError(null);

    try {
      const res = await fetch('/api/share-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId,
          expiresInHours,
          maxViews: maxViews > 0 ? maxViews : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create share link');
      }

      setShareUrl(data.data.shareUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create share link');
    } finally {
      setIsCreating(false);
    }
  }, [documentId, expiresInHours, maxViews]);

  const copyToClipboard = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the text
      const input = document.querySelector('.share-url-input') as HTMLInputElement;
      if (input) input.select();
    }
  }, [shareUrl]);

  const reset = useCallback(() => {
    setIsOpen(false);
    setShareUrl(null);
    setError(null);
    setCopied(false);
  }, []);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) reset(); setIsOpen(open); }}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Link2 className="h-4 w-4" /> Create Link
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Secure Share Link</DialogTitle>
        </DialogHeader>

        {!shareUrl ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="block text-xs font-medium text-ink-500">Expires After</label>
              <select
                value={expiresInHours}
                onChange={(e) => setExpiresInHours(Number(e.target.value))}
                className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
              >
                <option value={1}>1 hour</option>
                <option value={24}>24 hours</option>
                <option value={168}>7 days</option>
                <option value={720}>30 days</option>
                <option value={8760}>1 year</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-ink-500">
                Max Views <span className="text-ink-400">(0 = unlimited)</span>
              </label>
              <input
                type="number"
                min={0}
                value={maxViews}
                onChange={(e) => setMaxViews(Number(e.target.value))}
                className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
              />
            </div>

            {error && (
              <p className="text-xs text-status-error-text">{error}</p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => reset()}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={createLink} loading={isCreating}>
                <Link2 className="h-4 w-4" /> Generate Link
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-ink-500">
              Share this link securely. Anyone with the link can view the document.
            </p>

            <div className="flex items-center gap-2 rounded-[8px] border border-border bg-muted/30 p-2">
              <input
                type="text"
                readOnly
                value={shareUrl}
                className="share-url-input flex-1 bg-transparent text-xs font-mono text-ink-950 outline-none"
              />
              <Button variant="secondary" size="compact" onClick={copyToClipboard}>
                {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>

            <div className="flex justify-end">
              <Button variant="primary" size="sm" onClick={reset}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
