/**
 * TripAuthorityPreview — an official-document preview.
 *
 * A sanitised, clearly-labelled preview of a generated Trip Authority
 * document — the kind of official output GovFleet produces for every
 * authorised trip. Demonstrative only; not a real document.
 */

import { PreviewShell } from '@/components/public/previews/preview-shell';
import { Stamp } from 'lucide-react';

export interface TripAuthorityPreviewProps {
  className?: string;
}

export function TripAuthorityPreview({
  className,
}: TripAuthorityPreviewProps) {
  return (
    <PreviewShell
      title="trip-authority-0412.pdf"
      eyebrow="PDF"
      className={className}
    >
      <div className="rounded-[8px] border border-border bg-surface p-3.5">
        {/* Letterhead */}
        <div className="flex items-start justify-between gap-3 border-b border-border pb-2.5">
          <div>
            <p className="text-[12px] font-bold text-ink-950">
              REPUBLIC OF NAMIBIA
            </p>
            <p className="text-[10px] text-ink-500">
              Regional Council · Transport Authority
            </p>
          </div>
          <span className="rounded-[6px] border border-brand-300 bg-brand-50 px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-brand-800 dark:bg-brand-900/40 dark:text-brand-300 dark:border-brand-800">
            Trip Authority
          </span>
        </div>

        <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px]">
          <DocRow label="Authority No." value="TA-2026/0412" />
          <DocRow label="Vehicle" value="KD-021 · Hilux 4×4" />
          <DocRow label="Driver" value="J. Nekongo" />
          <DocRow label="Route" value="Rundu → Divundu" />
          <DocRow label="Dates" value="18–20 Aug 2026" />
          <DocRow label="Passengers" value="4" />
        </dl>

        <div className="mt-3 flex items-end justify-between border-t border-border pt-2.5">
          <div>
            <p className="text-[9px] text-ink-400">Authorised by</p>
            <p className="text-[10px] font-medium text-ink-800">
              Chief Executive Office
            </p>
          </div>
          <div className="flex items-center gap-1 text-[10px] font-semibold text-brand-700 dark:text-brand-400">
            <Stamp className="h-3.5 w-3.5" aria-hidden="true" />
            AUTHORISED
          </div>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-ink-400">
        Every operational decision creates a traceable, exportable record
      </p>
    </PreviewShell>
  );
}

function DocRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-400">{label}</dt>
      <dd className="font-medium text-ink-800">{value}</dd>
    </div>
  );
}
