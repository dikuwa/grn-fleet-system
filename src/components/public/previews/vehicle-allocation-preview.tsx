/**
 * VehicleAllocationPreview — a sanitised allocation-table preview.
 *
 * Shows vehicle, driver, trip dates, route and allocation status for a set
 * of trips. Static demo content.
 */

import { PreviewShell } from '@/components/public/previews/preview-shell';

const ROWS = [
  {
    vehicle: 'KD-021 · Hilux Double Cab',
    driver: 'J. Nekongo',
    dates: '18–20 Aug',
    route: 'Rundu → Divundu',
    status: 'Allocated',
    tone: 'bg-status-info-bg text-status-info-text',
  },
  {
    vehicle: 'KD-044 · Corolla Cross',
    driver: 'T. Haipinge',
    dates: '19 Aug',
    route: 'Windhoek → Okahandja',
    status: 'Issued',
    tone: 'bg-status-success-bg text-status-success-text',
  },
  {
    vehicle: 'KD-112 · Land Cruiser',
    driver: '—',
    dates: '22–24 Aug',
    route: 'Katima → Kongola',
    status: 'Awaiting Driver',
    tone: 'bg-status-pending-bg text-status-pending-text',
  },
];

export interface VehicleAllocationPreviewProps {
  className?: string;
}

export function VehicleAllocationPreview({
  className,
}: VehicleAllocationPreviewProps) {
  return (
    <PreviewShell title="vehicle allocation" className={className}>
      <div className="overflow-hidden rounded-[8px] border border-border">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border bg-muted/70 text-[10px] text-ink-500">
              <th className="px-2.5 py-2 font-medium">Vehicle</th>
              <th className="px-2.5 py-2 font-medium">Driver</th>
              <th className="hidden px-2.5 py-2 font-medium sm:table-cell">Dates</th>
              <th className="hidden px-2.5 py-2 font-medium md:table-cell">Route</th>
              <th className="px-2.5 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="bg-surface">
            {ROWS.map((row) => (
              <tr
                key={row.vehicle}
                className="border-b border-border/70 last:border-0"
              >
                <td className="px-2.5 py-2 text-[11px] font-medium text-ink-800">
                  {row.vehicle}
                </td>
                <td className="px-2.5 py-2 text-[11px] text-ink-600">{row.driver}</td>
                <td className="hidden px-2.5 py-2 text-[11px] text-ink-600 sm:table-cell">
                  {row.dates}
                </td>
                <td className="hidden px-2.5 py-2 text-[11px] text-ink-600 md:table-cell">
                  {row.route}
                </td>
                <td className="px-2.5 py-2">
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${row.tone}`}
                  >
                    {row.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-ink-400">
        Defect &amp; availability checks · recommended vehicle matching · driver licence validation
      </p>
    </PreviewShell>
  );
}
