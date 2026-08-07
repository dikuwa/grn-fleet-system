/**
 * ApprovalWorkflowPreview — a sanitised approval-chain preview.
 *
 * Shows the multi-level approval journey for a transport request: each stage
 * with its reviewer and decision. Static demo content that reflects the real
 * role-based approval design without advertising a fixed approval count.
 */

import { PreviewShell } from '@/components/public/previews/preview-shell';

const STAGES = [
  {
    name: 'Supervisor Review',
    owner: 'H. Shikongo · Roads & Transport',
    status: 'Approved',
    tone: 'bg-status-success-bg text-status-success-text',
  },
  {
    name: 'Transport Review & Allocation',
    owner: 'M. Nangolo · Transport Office',
    status: 'Approved',
    tone: 'bg-status-success-bg text-status-success-text',
  },
  {
    name: 'Administrative Release',
    owner: 'Regional Secretariat',
    status: 'In Review',
    tone: 'bg-status-info-bg text-status-info-text',
  },
  {
    name: 'Final Authorisation',
    owner: 'Chief Executive Office',
    status: 'Pending',
    tone: 'bg-status-pending-bg text-status-pending-text',
  },
];

export interface ApprovalWorkflowPreviewProps {
  className?: string;
}

export function ApprovalWorkflowPreview({
  className,
}: ApprovalWorkflowPreviewProps) {
  return (
    <PreviewShell title="TR-2026-0412 · approval chain" className={className}>
      <ol className="relative space-y-3 before:absolute before:inset-y-2 before:left-[7px] before:w-px before:bg-border">
        {STAGES.map((stage, i) => (
          <li key={stage.name} className="relative flex items-start gap-3 pl-0">
            <span
              className={`relative z-10 mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-surface ${
                i === 0 || i === 1
                  ? 'bg-status-success-text'
                  : i === 2
                    ? 'bg-brand-600'
                    : 'bg-ink-300'
              }`}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1 rounded-[8px] border border-border bg-surface p-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[11px] font-semibold text-ink-800">
                  {stage.name}
                </p>
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${stage.tone}`}
                >
                  {stage.status}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[10px] text-ink-400">{stage.owner}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[10px] text-ink-400">
        Configurable approval workflows · every decision is logged with reviewer, timestamp and comment
      </p>
    </PreviewShell>
  );
}
