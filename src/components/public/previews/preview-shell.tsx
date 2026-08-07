/**
 * PreviewShell — shared window-frame chrome for public product previews.
 *
 * Gives every "screenshot" a consistent application frame (traffic dots +
 * title bar + content surface) so the previews read as one product, while
 * each preview body stays a lightweight server component with static demo
 * data. Never queries tenant data.
 */

import { cn } from '@/lib/utils';

export interface PreviewShellProps {
  title?: string;
  eyebrow?: string;
  children: React.ReactNode;
  className?: string;
  /** Show traffic-light window dots (default true) */
  windowChrome?: boolean;
}

export function PreviewShell({
  title,
  eyebrow,
  children,
  className,
  windowChrome = true,
}: PreviewShellProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-[12px] border border-border bg-surface shadow-sm',
        className,
      )}
    >
      {windowChrome && (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/60 px-4 py-2.5">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-ink-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-ink-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-ink-300" />
          </div>
          {title && (
            <span className="truncate font-mono text-[11px] text-ink-500">
              {title}
            </span>
          )}
          {eyebrow && (
            <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-medium text-ink-500">
              {eyebrow}
            </span>
          )}
        </div>
      )}
      <div className="bg-canvas/50 p-4 sm:p-5">{children}</div>
    </div>
  );
}
