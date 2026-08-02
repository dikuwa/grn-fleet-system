'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { StyledSelect } from '@/components/ui/styled-select';
import { Textarea } from '@/components/ui/input';
import { useToast } from '@/lib/use-toast';
import { subscribe, getSnapshot, clearSelection, getSelectedIds, isSelected, toggleId } from '@/lib/bulk-selection';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CheckSquare, Archive, RotateCcw, CalendarClock } from 'lucide-react';

export interface BulkTarget {
  id: string;
  name: string;
  employmentStatus: string;
}

interface StaffBulkBarProps {
  staff: BulkTarget[];
  canManageLifecycle: boolean;
  canManageStaff: boolean;
  offices: Array<{ id: string; name: string }>;
  departments: Array<{ id: string; name: string }>;
}

type BulkAction =
  | 'mark_active'
  | 'mark_inactive'
  | 'set_availability'
  | 'assign_office'
  | 'assign_department'
  | 'archive'
  | 'restore';

const ACTION_LABELS: Record<BulkAction, string> = {
  mark_active: 'Mark Active',
  mark_inactive: 'Mark Inactive',
  set_availability: 'Set Availability',
  assign_office: 'Assign Office',
  assign_department: 'Assign Department',
  archive: 'Archive',
  restore: 'Restore',
};

export function StaffBulkBar({ staff, canManageLifecycle, canManageStaff, offices, departments }: StaffBulkBarProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [action, setAction] = useState<BulkAction>('mark_active');
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [availability, setAvailability] = useState('available');
  const [officeId, setOfficeId] = useState('');
  const [departmentId, setDepartmentId] = useState('');

  // Derive currently-selected rows from the shared selection store. Rows that
  // leave the page (pagination/filter change) are pruned server-side by the API.
  const getCountSnapshot = useMemo(
    () => () => staff.filter((row) => getSnapshot().has(row.id)).length,
    [staff],
  );
  const count = useSyncExternalStore(subscribe, getCountSnapshot, () => 0);
  const allChecked = count > 0 && count === staff.length;

  function handleSelectAll(e: React.ChangeEvent<HTMLInputElement>) {
    const checked = e.target.checked;
    const pageIds = staff.map((row) => row.id);
    // Toggle the rows on this page so the shared store converges.
    pageIds.forEach((id) => {
      if (checked && !isSelected(id)) toggleId(id);
      if (!checked && isSelected(id)) toggleId(id);
    });
  }

  const runBulk = useCallback(
    async (payload: Record<string, unknown>) => {
      setBusy(true);
      try {
        const res = await fetch('/api/employees/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Bulk update failed');
        toast({ title: 'Bulk update applied', description: `${data.updated ?? 0} employee(s) updated.`, variant: 'success' });
        clearSelection();
        router.refresh();
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Bulk update failed';
        toast({ title: 'Bulk update failed', description: msg, variant: 'error' });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [router, toast],
  );

  function needsReason(action: BulkAction) {
    return action === 'archive';
  }

  async function handleConfirm(): Promise<boolean> {
    const ids = getSelectedIds();
    if (ids.length === 0) return false;
    const payload: Record<string, unknown> = { ids, action };
    if (action === 'set_availability') payload.availability = availability;
    if (action === 'assign_office') payload.officeId = officeId;
    if (action === 'assign_department') payload.departmentId = departmentId;
    if (needsReason(action) && reason.trim()) payload.reason = reason.trim();
    const ok = await runBulk(payload);
    if (ok) {
      setConfirmOpen(false);
      setReason('');
      setAvailability('available');
      setOfficeId('');
      setDepartmentId('');
    }
    return ok;
  }

  const canRun =
    canManageLifecycle &&
    (action === 'assign_office' || action === 'assign_department' ? canManageStaff : true);

  if (count === 0 && !allChecked) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-700 select-none">
          <input
            type="checkbox"
            checked={allChecked}
            onChange={handleSelectAll}
            className="border-border text-brand-600 focus:ring-brand-500 h-4 w-4 rounded"
          />
          Select all on page
        </label>
        {count > 0 && (
          <span className="text-ink-500 text-xs">
            {count} selected — {ACTION_LABELS[action].toLowerCase()}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="border-brand-200 bg-brand-50/60 dark:bg-brand-950/20 flex flex-wrap items-center gap-3 rounded-[8px] border px-3 py-2">
      <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-700 select-none">
        <input
          type="checkbox"
          checked={allChecked}
          onChange={handleSelectAll}
          className="border-border text-brand-600 focus:ring-brand-500 h-4 w-4 rounded"
        />
        All on page
      </label>
      <span className="text-brand-800 text-xs font-semibold">{count} selected</span>

      <StyledSelect
        value={action}
        onChange={(e) => setAction(e.target.value as BulkAction)}
        aria-label="Bulk action"
        className="w-44"
      >
        {(Object.keys(ACTION_LABELS) as BulkAction[]).map((key) => (
          <option key={key} value={key}>
            {ACTION_LABELS[key]}
          </option>
        ))}
      </StyledSelect>

      {action === 'set_availability' && (
        <StyledSelect value={availability} onChange={(e) => setAvailability(e.target.value)} aria-label="Availability">
          <option value="available">Available</option>
          <option value="annual_leave">Annual leave</option>
          <option value="sick_leave">Sick leave</option>
          <option value="official_travel">Official travel</option>
          <option value="training">Training</option>
          <option value="off_duty">Off duty</option>
          <option value="temporarily_unavailable">Temporarily unavailable</option>
        </StyledSelect>
      )}
      {action === 'assign_office' && (
        <StyledSelect value={officeId} onChange={(e) => setOfficeId(e.target.value)} aria-label="Office">
          <option value="">Select office…</option>
          {offices.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </StyledSelect>
      )}
      {action === 'assign_department' && (
        <StyledSelect value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} aria-label="Department">
          <option value="">Select department…</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </StyledSelect>
      )}

      <div className="ml-auto flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => clearSelection()}>
          Clear
        </Button>
        <Button
          variant={action === 'archive' ? 'destructive' : 'primary'}
          size="sm"
          loading={busy}
          disabled={!canRun || (action === 'assign_office' && !officeId) || (action === 'assign_department' && !departmentId)}
          onClick={() => {
            if (needsReason(action)) setConfirmOpen(true);
            else void handleConfirm();
          }}
        >
          {action === 'archive' ? <Archive className="h-4 w-4" /> : action === 'restore' ? <RotateCcw className="h-4 w-4" /> : action === 'set_availability' ? <CalendarClock className="h-4 w-4" /> : <CheckSquare className="h-4 w-4" />}
          {ACTION_LABELS[action]}
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Archive {count} employee{count !== 1 ? 's' : ''}?</DialogTitle>
            <DialogDescription>
              Archived staff are removed from normal operational use while history is preserved. This is a
              destructive action — provide a reason for the audit trail.
            </DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for archiving" rows={4} autoFocus />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={busy}
              disabled={!reason.trim()}
              onClick={async () => {
                const ok = await handleConfirm();
                if (ok) setConfirmOpen(false);
              }}
            >
              <Archive className="h-4 w-4" /> Archive employees
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Per-row checkbox bound to the shared selection store. */
export function StaffBulkCheckbox({ id, label }: { id: string; label: string }) {
  const [checked, setChecked] = useState(isSelected(id));
  useEffect(() => {
    return subscribe(() => setChecked(isSelected(id)));
  }, [id]);
  return (
    <input
      type="checkbox"
      aria-label={`Select ${label}`}
      checked={checked}
      onChange={() => toggleId(id)}
      className="border-border text-brand-600 focus:ring-brand-500 h-4 w-4 rounded"
    />
  );
}
