'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Copy, Link2, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDate, formatDateTime } from '@/lib/utils';
import { useToast } from '@/lib/use-toast';

export function ShareLinkItem({
  id,
  shareUrl,
  expiresAt,
  currentViews,
  maxViews,
  lastAccessedAt,
  verificationCode,
}: {
  id: string;
  shareUrl: string;
  expiresAt: Date;
  currentViews: number;
  maxViews: number | null;
  lastAccessedAt: Date | null;
  verificationCode: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
    toast({ title: 'Secure link copied', variant: 'success' });
  };

  const revoke = async () => {
    if (!window.confirm('Revoke this secure link immediately?')) return;
    setRevoking(true);
    const response = await fetch(`/api/share-links?linkId=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    setRevoking(false);
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      toast({
        title: 'Link not revoked',
        description: result.error || 'Please try again.',
        variant: 'error',
      });
      return;
    }
    toast({ title: 'Secure link revoked', variant: 'success' });
    router.refresh();
  };

  return (
    <div className="border-border bg-muted/30 flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Link2 className="text-brand-600 h-4 w-4" />
          <span className="text-ink-950 text-sm font-medium">Secure verification link</span>
          <Badge variant="success" size="sm">
            Active
          </Badge>
        </div>
        <p className="text-ink-500 mt-1 font-mono text-xs break-all">{shareUrl}</p>
        <p className="text-ink-500 mt-1 text-xs">
          Expires {formatDate(expiresAt)} · {currentViews}/{maxViews || '∞'} views
          {lastAccessedAt
            ? ` · Last opened ${formatDateTime(lastAccessedAt)}`
            : ' · Not opened yet'}
          {verificationCode ? ` · Code ${verificationCode}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="secondary" size="sm" onClick={copy}>
          {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="text-status-error-text"
          onClick={revoke}
          disabled={revoking}
          aria-label="Revoke secure link"
        >
          {revoking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
