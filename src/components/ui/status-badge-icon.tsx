'use client';

import { cn } from '@/lib/utils';
import { getStatusIconConfig } from '@/lib/status-icons';
import { Badge } from '@/components/ui/badge';
import { Clock3, type LucideIcon } from 'lucide-react';

/**
 * StatusBadgeWithIcon renders a status with a Lucide icon from the
 * centralised status configuration. Provides consistent status display
 * across trips, dashboards, notifications, and approvals.
 *
 * Usage:
 *   <StatusBadgeWithIcon status="in_progress" />
 *   <StatusBadgeWithIcon status="return_due" iconOnly />
 */

interface StatusBadgeWithIconProps {
  /** Status code (e.g. "in_progress", "return_due", "closed") */
  status: string | null | undefined;
  /** Show only the icon (no label) — useful for compact views */
  iconOnly?: boolean;
  /** Override the label text */
  label?: string;
  /** Additional CSS classes */
  className?: string;
  /** Icon size (default: 14px) */
  iconSize?: number;
}

const VARIANT_MAP: Record<string, 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency' | 'default'> = {
  success: 'success',
  pending: 'pending',
  info: 'info',
  error: 'error',
  cancelled: 'cancelled',
  emergency: 'emergency',
  default: 'default',
};

export function StatusBadgeWithIcon({
  status,
  iconOnly = false,
  label,
  className,
  iconSize = 14,
}: StatusBadgeWithIconProps) {
  const config = getStatusIconConfig(status);
  const Icon: LucideIcon = config.icon || Clock3;
  const badgeVariant = VARIANT_MAP[config.variant] || 'default';
  const displayLabel = label || config.label;

  if (iconOnly) {
    return (
      <span
        className={cn('inline-flex items-center justify-center', className)}
        title={displayLabel}
        aria-label={displayLabel}
      >
        <Icon
          className={cn(
            'shrink-0',
            config.variant === 'success' && 'text-status-success-text',
            config.variant === 'error' && 'text-status-error-text',
            config.variant === 'pending' && 'text-status-pending-text',
            config.variant === 'info' && 'text-status-info-text',
            config.variant === 'cancelled' && 'text-status-cancelled-text',
            config.variant === 'emergency' && 'text-status-emergency-text',
            config.variant === 'default' && 'text-ink-500',
          )}
          style={{ width: iconSize, height: iconSize }}
        />
      </span>
    );
  }

  return (
    <Badge variant={badgeVariant} size="sm" className={cn('gap-1', className)}>
      <Icon
        className="shrink-0"
        style={{ width: iconSize - 2, height: iconSize - 2 }}
      />
      {displayLabel}
    </Badge>
  );
}


