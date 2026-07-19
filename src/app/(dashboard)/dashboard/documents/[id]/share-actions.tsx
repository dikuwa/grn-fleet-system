'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Share2, Smartphone, Copy, CheckCircle2 } from 'lucide-react';

interface Props {
  shareUrl?: string;
  documentTitle: string;
  documentId: string;
}

export function ShareActions({ shareUrl, documentTitle }: Props) {
  const [copied, setCopied] = useState(false);

  const hasShareApi = typeof window !== 'undefined' && 'share' in navigator;

  const handleNativeShare = useCallback(async () => {
    const urlToShare = shareUrl || window.location.href;

    if (hasShareApi) {
      try {
        await navigator.share({
          title: documentTitle,
          text: `${documentTitle} — Government Fleet Management System`,
          url: urlToShare,
        });
      } catch (err) {
        // User cancelled or share failed — fall back to clipboard
        if (err instanceof Error && err.name !== 'AbortError') {
          await navigator.clipboard.writeText(urlToShare);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
      }
    } else {
      // Web Share API not supported — copy to clipboard
      try {
        await navigator.clipboard.writeText(urlToShare);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Clipboard API not available either
        const textarea = document.createElement('textarea');
        textarea.value = urlToShare;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  }, [shareUrl, documentTitle, hasShareApi]);

  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" size="sm" onClick={handleNativeShare}>
        {copied ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : hasShareApi ? (
          <Share2 className="h-4 w-4" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
        {copied ? 'Copied!' : hasShareApi ? 'Share' : 'Copy Link'}
      </Button>
    </div>
  );
}
