import { AlertTriangle, CheckCircle2, Fuel, Wrench } from 'lucide-react';
import { PreviewShell } from '@/components/public/previews/preview-shell';
import { cn } from '@/lib/utils';

export function InspectionPreview({ className }: { className?: string }) {
  return (
    <PreviewShell title="vehicle inspection" eyebrow="Operational" className={className}>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-ink-400">KD-044 · Return check</p>
            <p className="mt-0.5 text-xs font-semibold text-ink-950">Inspection in progress</p>
          </div>
          <span className="rounded-full bg-status-warning-bg px-2 py-1 text-[10px] font-medium text-status-warning-text">
            1 issue
          </span>
        </div>
        <div className="space-y-2">
          {[
            ['Tyres & wheels', 'Passed'],
            ['Lights & indicators', 'Passed'],
            ['Body / visible damage', 'Defect'],
          ].map(([label, status]) => (
            <div key={label} className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2">
              <span className="text-[11px] text-ink-700">{label}</span>
              <span className={cn('flex items-center gap-1 text-[10px] font-medium', status === 'Passed' ? 'text-status-success-text' : 'text-status-warning-text')}>
                {status === 'Passed' ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                {status}
              </span>
            </div>
          ))}
        </div>
        <p className="text-[10px] leading-relaxed text-ink-400">Critical failures can block release and create a tracked defect automatically.</p>
      </div>
    </PreviewShell>
  );
}

export function FuelManagementPreview({ className }: { className?: string }) {
  return (
    <PreviewShell title="fuel entry" eyebrow="Validated" className={className}>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <div className="rounded-md border border-border bg-surface p-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
                <Fuel className="h-3.5 w-3.5" />
              </span>
              <div>
                <p className="text-[10px] text-ink-400">KD-021 · Trip 6</p>
                <p className="text-xs font-semibold text-ink-950">45.2 L · N$ 1,084.80</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="rounded-md border border-border bg-surface p-2.5">
              <p className="text-ink-400">Odometer</p>
              <p className="mt-1 font-semibold text-ink-900">84,215 km</p>
            </div>
            <div className="rounded-md border border-border bg-surface p-2.5">
              <p className="text-ink-400">Receipt</p>
              <p className="mt-1 font-semibold text-status-success-text">Captured</p>
            </div>
          </div>
        </div>
        <div className="flex min-w-24 flex-col justify-center rounded-md border border-border bg-surface p-3 text-center">
          <span className="text-lg font-semibold tabular-nums text-ink-950">9.8</span>
          <span className="text-[9px] uppercase tracking-wide text-ink-400">L / 100 km</span>
          <span className="mt-2 text-[10px] text-status-success-text">Within range</span>
        </div>
      </div>
    </PreviewShell>
  );
}

export function MaintenancePreview({ className }: { className?: string }) {
  return (
    <PreviewShell title="maintenance" eyebrow="Due soon" className={className}>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
              <Wrench className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-semibold text-ink-950">KD-112 · Land Cruiser</p>
              <p className="text-[10px] text-ink-400">Next service at 90,000 km</p>
            </div>
          </div>
          <span className="text-[10px] font-medium text-status-warning-text">1,240 km left</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-[78%] rounded-full bg-brand-600" />
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            ['Roadworthy', '38 days'],
            ['Insurance', '62 days'],
            ['Service', 'Due soon'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border border-border bg-surface px-2 py-2.5">
              <p className="text-[9px] text-ink-400">{label}</p>
              <p className="mt-1 text-[10px] font-semibold text-ink-900">{value}</p>
            </div>
          ))}
        </div>
      </div>
    </PreviewShell>
  );
}
