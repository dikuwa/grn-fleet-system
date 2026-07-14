import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Inbox, AlertCircle, ShieldAlert } from 'lucide-react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-[10px] border border-dashed border-border bg-surface px-6 py-12 text-center',
        className,
      )}
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-ink-500">
        {icon || <Inbox className="h-6 w-6" />}
      </div>
      <h3 className="text-sm font-semibold text-ink-950">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-ink-500">{description}</p>
      )}
      {action && (
        <Button variant="primary" size="sm" className="mt-4" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

interface LoadingStateProps {
  className?: string;
}

export function LoadingSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-[8px] bg-muted',
        className || 'h-4 w-full',
      )}
    />
  );
}

export function LoadingState({ className }: LoadingStateProps) {
  return (
    <div className={cn('space-y-4', className)}>
      <LoadingSkeleton className="h-8 w-48" />
      <LoadingSkeleton className="h-4 w-96" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <LoadingSkeleton key={i} className="h-28" />
        ))}
      </div>
      <LoadingSkeleton className="h-64 w-full" />
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message?: string;
  retry?: () => void;
  className?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'An unexpected error occurred. Please try again.',
  retry,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-[10px] border border-status-error-bg bg-status-error-bg px-6 py-12 text-center',
        className,
      )}
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-white text-status-error-text">
        <AlertCircle className="h-6 w-6" />
      </div>
      <h3 className="text-sm font-semibold text-status-error-text">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-status-error-text/80">{message}</p>
      {retry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={retry}>
          Try Again
        </Button>
      )}
    </div>
  );
}

interface PermissionDeniedProps {
  className?: string;
}

export function PermissionDenied({ className }: PermissionDeniedProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-[10px] border border-border bg-surface px-6 py-12 text-center',
        className,
      )}
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-ink-500">
        <ShieldAlert className="h-6 w-6" />
      </div>
      <h3 className="text-sm font-semibold text-ink-950">Access Restricted</h3>
      <p className="mt-1 max-w-sm text-sm text-ink-500">
        You do not have the required permissions to view this page. Contact your
        Transport Administrator if you need access.
      </p>
    </div>
  );
}

interface OfflineBannerProps {
  className?: string;
}

export function OfflineBanner({ className }: OfflineBannerProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-[8px] bg-status-pending-bg px-3 py-2 text-xs font-medium text-status-pending-text',
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-status-pending-text animate-pulse" />
      You are offline. Drafts are saved locally and will sync when connected.
    </div>
  );
}
