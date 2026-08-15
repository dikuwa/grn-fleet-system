import type { ReactNode } from 'react';

export default function ReportsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="reports-modern-shell">
      {children}
      <style>{`
        .reports-modern-shell button,
        .reports-modern-shell a[href] {
          cursor: pointer;
        }

        .reports-modern-shell .report-surface > div > div,
        .reports-modern-shell .report-surface > div > section {
          min-width: 0;
        }

        /* Existing report bars carry their value in title. Enhance those bars
           without changing report data or introducing a second chart library. */
        .reports-modern-shell .report-surface div[title][style*="background-color"] {
          position: relative;
          cursor: default;
          border-radius: 6px 6px 2px 2px !important;
          box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 8%, transparent);
          transform-origin: bottom;
          transition: transform 160ms ease, opacity 160ms ease, filter 160ms ease, box-shadow 160ms ease;
          outline: none;
        }

        .reports-modern-shell .report-surface div[title][style*="background-color"]:hover,
        .reports-modern-shell .report-surface div[title][style*="background-color"]:focus-visible {
          opacity: 1 !important;
          filter: saturate(1.08) brightness(1.02);
          transform: translateY(-2px) scaleY(1.025);
          box-shadow: 0 6px 18px color-mix(in srgb, var(--color-ink-950, #0f172a) 12%, transparent);
          z-index: 5;
        }

        .reports-modern-shell .report-surface div[title][style*="background-color"]::after {
          content: attr(title);
          pointer-events: none;
          position: absolute;
          left: 50%;
          bottom: calc(100% + 8px);
          translate: -50% 4px;
          min-width: max-content;
          max-width: 180px;
          padding: 5px 8px;
          border: 1px solid var(--color-border, #d8dee8);
          border-radius: 7px;
          background: var(--color-surface, #fff);
          color: var(--color-ink-950, #111827);
          box-shadow: 0 8px 24px color-mix(in srgb, var(--color-ink-950, #0f172a) 14%, transparent);
          font-size: 11px;
          font-weight: 600;
          line-height: 1.2;
          opacity: 0;
          visibility: hidden;
          transition: opacity 140ms ease, translate 140ms ease, visibility 140ms ease;
          white-space: nowrap;
        }

        .reports-modern-shell .report-surface div[title][style*="background-color"]:hover::after,
        .reports-modern-shell .report-surface div[title][style*="background-color"]:focus-visible::after {
          opacity: 1;
          visibility: visible;
          translate: -50% 0;
        }

        /* Status/proportion rails used by Fleet, Trips, Requests and Approvals. */
        .reports-modern-shell .report-surface .bg-muted.h-2.w-full {
          height: 10px;
          padding: 1px;
          border: 1px solid var(--color-border, #d8dee8);
          background: color-mix(in srgb, var(--color-muted, #eef2f7) 86%, transparent);
          box-shadow: inset 0 1px 2px color-mix(in srgb, var(--color-ink-950, #0f172a) 5%, transparent);
        }

        .reports-modern-shell .report-surface .bg-muted.h-2.w-full > div {
          min-width: 2px;
          border-radius: 999px;
          box-shadow: 0 1px 3px color-mix(in srgb, var(--color-ink-950, #0f172a) 10%, transparent);
          transition: width 220ms ease, filter 160ms ease;
        }

        .reports-modern-shell .report-surface .bg-muted.h-2.w-full:hover > div {
          filter: saturate(1.1) brightness(1.03);
        }

        /* Give analytical cards depth without turning them into menu tiles. */
        .reports-modern-shell .report-surface [class*="rounded-["] {
          scroll-margin-top: 90px;
        }

        .reports-modern-shell .report-surface table tbody tr {
          transition: background-color 140ms ease;
        }

        @media (prefers-reduced-motion: reduce) {
          .reports-modern-shell .report-surface div[title][style*="background-color"],
          .reports-modern-shell .report-surface div[title][style*="background-color"]::after,
          .reports-modern-shell .report-surface .bg-muted.h-2.w-full > div,
          .reports-modern-shell .report-surface table tbody tr {
            transition: none !important;
            transform: none !important;
          }
        }

        @media print {
          .reports-modern-shell .report-surface div[title][style*="background-color"]::after {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
