import { cn } from '@/lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
}

function Card({ className, hover, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'border-border bg-surface rounded-[10px] border',
        hover && 'hover:border-brand-100 transition-all hover:shadow-sm',
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
  return <h3 className={cn('text-ink-950 text-sm font-semibold', className)} {...props} />;
}

function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-ink-500 text-sm', className)} {...props} />;
}

function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-w-0 px-4 pb-4 sm:px-5', className)} {...props} />;
}

function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'border-border flex min-w-0 flex-wrap items-center gap-3 border-t px-4 py-3 sm:justify-between sm:px-5',
        className,
      )}
      {...props}
    />
  );
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };

/**
 * StatCard for KPI dashboard cards
 */
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
        <div className="flex items-start justify-between pt-4">
          <div className="space-y-1">
            <p className="text-ink-500 text-xs font-medium tracking-wider uppercase">{title}</p>
            <p className="text-ink-950 text-2xl font-[650] tabular-nums">{value}</p>
            {description && <p className="text-ink-500 text-xs">{description}</p>}
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
            <div className="bg-brand-50 text-brand-700 flex h-10 w-10 items-center justify-center rounded-lg">
              {icon}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
