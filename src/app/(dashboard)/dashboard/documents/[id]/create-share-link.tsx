'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { StyledSelect } from '@/components/ui/styled-select';
import { Link2, Copy, CheckCircle2 } from 'lucide-react';

type ExternalRedactionProfile = 'external_standard' | 'external_minimal';

interface Props {
  documentId: string;
  disabled?: boolean;
}

export function CreateShareLinkButton({ documentId, disabled = false }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [expiresInHours, setExpiresInHours] = useState(168); // 7 days
  const [maxViews, setMaxViews] = useState<number>(0);
  const [allowDownload, setAllowDownload] = useState(false);
  const [redactionProfile, setRedactionProfile] =
    useState<ExternalRedactionProfile>('external_standard');
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
          allowDownload,
          redactionProfile,
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
  }, [allowDownload, documentId, expiresInHours, maxViews, redactionProfile]);

  const copyToClipboard = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
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
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) reset();
        setIsOpen(open);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          title={disabled ? 'Issue the document before creating a public link' : undefined}
        >
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
              <label className="text-ink-500 block text-xs font-medium">Public disclosure</label>
              <StyledSelect
                value={redactionProfile}
                onChange={(event) =>
                  setRedactionProfile(event.target.value as ExternalRedactionProfile)
                }
              >
                <option value="external_standard">External Standard</option>
                <option value="external_minimal">External Minimal</option>
              </StyledSelect>
              <p className="text-ink-500 text-xs">
                {redactionProfile === 'external_minimal'
                  ? 'Shows document identity and verification only.'
                  : 'Adds safe trip or request context while hiding personal identifiers, signatures, internal comments, passenger lists and fuel-card details.'}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-ink-500 block text-xs font-medium">Expires After</label>
              <StyledSelect
                value={expiresInHours}
                onChange={(e) => setExpiresInHours(Number(e.target.value))}
              >
                <option value={1}>1 hour</option>
                <option value={24}>24 hours</option>
                <option value={168}>7 days</option>
                <option value={720}>30 days</option>
                <option value={8760}>1 year</option>
              </StyledSelect>
            </div>
            <label className="border-border flex items-start gap-3 rounded-lg border p-3">
              <input
                type="checkbox"
                checked={allowDownload}
                onChange={(event) => setAllowDownload(event.target.checked)}
                className="border-border mt-0.5 h-4 w-4 rounded"
              />
              <span>
                <span className="text-ink-950 block text-sm font-medium">
                  Allow redacted PDF download
                </span>
                <span className="text-ink-500 block text-xs">
                  The downloadable copy follows the public disclosure profile selected above.
                </span>
              </span>
            </label>

            <div className="space-y-2">
              <label className="text-ink-500 block text-xs font-medium">
                Max Views <span className="text-ink-400">(0 = unlimited)</span>
              </label>
              <input
                type="number"
                min={0}
                max={100000}
                value={maxViews}
                onChange={(e) => setMaxViews(Number(e.target.value))}
                className="border-border bg-surface text-ink-950 focus:ring-brand-600 h-10 w-full rounded-[8px] border px-3 text-sm focus:ring-2 focus:outline-none"
              />
            </div>

            {error && <p className="text-status-error-text text-xs">{error}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => reset()}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={createLink} loading={isCreating}>
                <Link2 className="h-4 w-4" /> Generate Link
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-ink-500 text-xs">
              Share this link securely. Anyone with the link can see only the disclosure profile you selected.
            </p>

            <div className="border-border bg-muted/30 flex items-center gap-2 rounded-[8px] border p-2">
              <input
                type="text"
                readOnly
                value={shareUrl}
                className="share-url-input text-ink-950 flex-1 bg-transparent font-mono text-xs outline-none"
              />
              <Button variant="secondary" size="compact" onClick={copyToClipboard}>
                {copied ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>

            <div className="flex justify-end">
              <Button variant="primary" size="sm" onClick={reset}>
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
