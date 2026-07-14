import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-muted text-ink-700',
        success: 'bg-status-success-bg text-status-success-text',
        pending: 'bg-status-pending-bg text-status-pending-text',
        info: 'bg-status-info-bg text-status-info-text',
        error: 'bg-status-error-bg text-status-error-text',
        cancelled: 'bg-status-cancelled-bg text-status-cancelled-text',
        emergency: 'bg-status-emergency-bg text-status-emergency-text',
      },
      size: {
        default: 'px-2.5 py-0.5 text-xs',
        sm: 'px-2 py-0.5 text-[11px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)} {...props} />
  );
}

export { Badge, badgeVariants };

/**
 * StatusBadge renders a dot + label for request/workflow statuses
 */
export function StatusBadge({
  status,
  label,
}: {
  status: BadgeProps['variant'];
  label: string;
}) {
  return (
    <Badge variant={status} className="gap-1.5">
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          status === 'success' && 'bg-status-success-text',
          status === 'pending' && 'bg-status-pending-text',
          status === 'info' && 'bg-status-info-text',
          status === 'error' && 'bg-status-error-text',
          status === 'cancelled' && 'bg-status-cancelled-text',
          status === 'emergency' && 'bg-status-emergency-text',
          (!status || status === 'default') && 'bg-ink-500',
        )}
      />
      {label}
    </Badge>
  );
}
