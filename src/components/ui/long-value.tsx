'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

interface LongValueProps {
  value: string | null | undefined;
  fallback?: string;
  copyable?: boolean;
  copyText?: string;
  className?: string;
  valueClassName?: string;
  ariaLabel?: string;
}

/**
 * A long operational value that truncates with an accessible tooltip on desktop
 * and wraps anywhere on narrow screens without expanding its parent.
 */
export function LongValue({
  value,
  fallback = '—',
  copyable = false,
  copyText,
  className,
  valueClassName,
  ariaLabel,
}: LongValueProps) {
  const [copied, setCopied] = useState(false);
  const displayValue = value || fallback;

  async function copyValue() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(copyText || value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied by the browser; the value remains selectable.
    }
  }

  const valueElement = (
    <span
      className={cn(
        'max-w-full min-w-0 flex-1 [overflow-wrap:anywhere] break-words whitespace-normal sm:overflow-hidden sm:text-ellipsis sm:whitespace-nowrap',
        valueClassName,
      )}
      tabIndex={value ? 0 : undefined}
      aria-label={ariaLabel ? `${ariaLabel}: ${displayValue}` : undefined}
    >
      {displayValue}
    </span>
  );

  return (
    <Tooltip.Provider delayDuration={300} skipDelayDuration={100}>
      <span className={cn('flex max-w-full min-w-0 items-center gap-1.5', className)}>
        {value ? (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>{valueElement}</Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="top"
                sideOffset={6}
                collisionPadding={8}
                className="bg-ink-950 text-surface z-50 hidden max-w-[min(20rem,calc(100vw-1rem))] rounded-[6px] px-2.5 py-1.5 text-xs leading-4 [overflow-wrap:anywhere] whitespace-normal shadow-lg sm:block"
              >
                {value}
                <Tooltip.Arrow className="fill-ink-950" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        ) : (
          valueElement
        )}
        {copyable && value ? (
          <button
            type="button"
            onClick={copyValue}
            className="text-ink-400 hover:bg-muted hover:text-ink-700 focus-visible:ring-brand-500 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] focus-visible:ring-2 focus-visible:outline-none"
            aria-label={copied ? `${ariaLabel || 'Value'} copied` : `Copy ${ariaLabel || 'value'}`}
            title={copied ? 'Copied' : `Copy ${ariaLabel || 'value'}`}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        ) : null}
      </span>
    </Tooltip.Provider>
  );
}
