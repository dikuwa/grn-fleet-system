'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { useToast } from '@/lib/use-toast';

type CopyFeedbackButtonProps = Omit<ButtonProps, 'children' | 'onClick'> & {
  text: string;
  label?: string;
  copiedLabel?: string;
  resetAfterMs?: number;
};

export function CopyFeedbackButton({
  text,
  label = 'Copy',
  copiedLabel = 'Copied',
  resetAfterMs = 1800,
  variant = 'secondary',
  ...buttonProps
}: CopyFeedbackButtonProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => {
        setCopied(false);
        resetTimer.current = null;
      }, resetAfterMs);
    } catch (error) {
      console.error('[Clipboard] Copy failed:', error);
      toast({
        title: 'Could not copy',
        description: 'Clipboard access was unavailable. Select and copy the credentials manually.',
        variant: 'error',
      });
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      onClick={() => void handleCopy()}
      aria-label={copied ? copiedLabel : label}
      {...buttonProps}
    >
      {copied ? (
        <Check className="h-4 w-4 text-status-success-text" aria-hidden="true" />
      ) : (
        <Copy className="h-4 w-4" aria-hidden="true" />
      )}
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </Button>
  );
}
