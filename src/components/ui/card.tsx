import { cn } from '@/lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
}

function Card({ className, hover, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)] border border-border bg-surface',
        hover &&
          'transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-brand-200 hover:shadow-sm motion-reduce:transform-none motion-reduce:transition-none dark:hover:border-brand-900',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-wrap items-center justify-between gap-3 px-4 py-4 sm:gap-4 sm:px-5',
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-sm font-semibold text-ink-950', className)} {...props} />;
}

function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm leading-relaxed text-ink-500', className)} {...props} />;
}

function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-w-0 px-4 pb-4 sm:px-5', className)} {...props} />;
}

function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-3 border-t border-border px-4 py-3 sm:justify-between sm:px-5',
        className,
      )}
      {...props}
    />
  );
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };

interface StatCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon?: React.ReactNode;
  trend?: { value: string; positive: boolean };
  className?: string;
}

export function StatCard({ title, value, description, icon, trend, className }: StatCardProps) {
  return (
    <Card className={className}>
      <CardContent>
        <div className="flex items-start justify-between gap-3 pt-4">
          <div className="min-w-0 space-y-1">
            <p className="truncate text-xs font-medium text-ink-500">{title}</p>
            <p className="truncate text-2xl font-[650] tabular-nums text-ink-950" title={String(value)}>
              {value}
            </p>
            {description && <p className="text-xs leading-relaxed text-ink-500">{description}</p>}
            {trend && (
              <p
                className={cn(
                  'text-xs font-medium',
                  trend.positive ? 'text-status-success-text' : 'text-status-error-text',
                )}
              >
                {trend.value}
              </p>
            )}
          </div>
          {icon && (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-600">
              {icon}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
