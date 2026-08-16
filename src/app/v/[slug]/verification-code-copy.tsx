'use client';

import { Copy } from 'lucide-react';
import { useToast } from '@/lib/use-toast';

export function VerificationCodeCopy({ value }: { value: string }) {
  const { toast } = useToast();

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(value);
      toast({
        title: 'Verification code copied',
        description: 'The secure verification code is ready to paste.',
        variant: 'success',
      });
    } catch {
      toast({
        title: 'Could not copy code',
        description: 'Select and copy the verification code manually.',
        variant: 'error',
      });
    }
  }

  return (
    <button
      type="button"
      onClick={copyCode}
      className="focus-ring text-ink-500 hover:text-ink-950 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors"
      aria-label="Copy verification code"
      title="Copy verification code"
    >
      <Copy className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
