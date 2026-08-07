/**
 * TransportRequestPreview — a sanitised transport-request form preview.
 *
 * Shows the real fields of the GovFleet request wizard (programme, route,
 * passengers, dates) with a submit/review state. Static demo content.
 */

import { PreviewShell } from '@/components/public/previews/preview-shell';

export interface TransportRequestPreviewProps {
  className?: string;
}

export function TransportRequestPreview({
  className,
}: TransportRequestPreviewProps) {
  return (
    <PreviewShell title="new transport request" className={className}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Programme / Activity" value="Community Outreach — Rundu East" wide />
        <Field label="Route" value="Rundu → Divundu (270 km)" wide />
        <Field label="Departure" value="Mon 18 Aug · 07:00" />
        <Field label="Return" value="Wed 20 Aug · 17:00" />
        <Field label="Passengers" value="4" />
        <Field label="Driver requirement" value="Official driver" />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-[8px] border border-border bg-canvas/50 p-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-brand-600" aria-hidden="true" />
          <p className="text-[11px] text-ink-600">
            Vehicle category recommended: <span className="font-medium text-ink-800">Double Cab 4×4</span>
          </p>
        </div>
        <span className="shrink-0 rounded-[6px] bg-brand-800 px-2.5 py-1 text-[10px] font-semibold text-white">
          Submit Request
        </span>
      </div>

      <p className="mt-2 text-[10px] text-ink-400">
        Multi-step wizard · route calculation · passenger manifest · programme linkage
      </p>
    </PreviewShell>
  );
}

function Field({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <p className="text-[10px] font-medium text-ink-500">{label}</p>
      <p className="mt-0.5 truncate rounded-[6px] border border-border bg-surface px-2 py-1.5 text-[11px] text-ink-800">
        {value}
      </p>
    </div>
  );
}
