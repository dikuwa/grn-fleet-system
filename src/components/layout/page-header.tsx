import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, children, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <h1 className="overflow-wrap-anywhere text-ink-950 text-xl font-[650] tracking-tight sm:text-2xl">
          {title}
        </h1>
        {description && <p className="text-ink-500 text-sm">{description}</p>}
      </div>
      {children && (
        <div className="page-header-actions flex min-w-0 flex-wrap items-center gap-2 sm:justify-end sm:gap-3">
          {children}
        </div>
      )}
    </div>
  );
}

interface BreadcrumbsProps {
  items: { label: string; href?: string }[];
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="text-ink-500 flex min-w-0 items-center gap-1.5 overflow-hidden text-xs sm:gap-2"
    >
      {items.map((item, i) => (
        <span
          key={i}
          className={cn(
            'min-w-0 items-center gap-1.5 sm:flex sm:gap-2',
            i !== 0 && i !== items.length - 1 ? 'hidden sm:flex' : 'flex',
          )}
        >
          {i > 0 && <span className="text-ink-300">/</span>}
          {item.href ? (
            <a
              href={item.href}
              className="touch-target hover:text-ink-700 max-w-[9rem] min-w-0 justify-start truncate transition-colors sm:max-w-none"
            >
              {item.label}
            </a>
          ) : (
            <span className="text-ink-700 min-w-0 truncate" title={item.label}>
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
