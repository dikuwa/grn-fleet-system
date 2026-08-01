'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { StyledSelect } from '@/components/ui/styled-select';
import { Textarea } from '@/components/ui/input';
import { useToast } from '@/lib/use-toast';
import {
  MoreHorizontal,
  Eye,
  Pencil,
  ShieldCheck,
  CalendarClock,
  Car,
  KeyRound,
  Archive,
  RotateCcw,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface StaffRowActionsProps {
  employeeId: string;
  employeeName: string;
  hasAccount: boolean;
  userId?: string | null;
  archived: boolean;
  canManageRoles: boolean;
  canManageAvailability: boolean;
  canManageDriver: boolean;
  canArchive: boolean;
  returnQuery?: string;
}

const MENU_ITEM =
  'text-ink-700 hover:bg-muted hover:text-ink-950 flex w-full items-center gap-2.5 rounded-[6px] px-3 py-2 text-left text-sm transition-colors';

export function StaffRowActions({
  employeeId,
  employeeName,
  hasAccount,
  userId,
  archived,
  canManageRoles,
  canManageAvailability,
  canManageDriver,
  canArchive,
  returnQuery = '',
}: StaffRowActionsProps) {
  const [open, setOpen] = useState(false);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [availability, setAvailability] = useState('available');
  const [archiveReason, setArchiveReason] = useState('');
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function runLifecycle(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/employees/${employeeId}/lifecycle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      toast({ title: 'Employee updated', variant: 'success' });
      router.refresh();
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Update failed';
      toast({ title: 'Update failed', description: msg, variant: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
  }

  const detailHref = `/dashboard/staff/${employeeId}${returnQuery ? `?${returnQuery}` : ''}`;
  const rolesHref = hasAccount && userId
    ? `/dashboard/admin/users/${userId}`
    : `/dashboard/admin/users`;

  return (
    <div ref={menuRef} className="relative inline-block">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Actions for ${employeeName}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>

      {open && (
        <div className="border-border bg-surface z-50 absolute right-0 mt-1 w-56 rounded-[10px] border p-1.5 shadow-lg">
          <Link
            href={detailHref}
            onClick={close}
            className={MENU_ITEM}
          >
            <Eye className="h-4 w-4" /> View
          </Link>
          <Link href={detailHref} onClick={close} className={MENU_ITEM}>
            <Pencil className="h-4 w-4" /> Edit
          </Link>
          {canManageRoles && (
            <Link href={rolesHref} onClick={close} className={MENU_ITEM}>
              <ShieldCheck className="h-4 w-4" /> Manage Roles
            </Link>
          )}
          {canManageAvailability && (
            <button
              type="button"
              className={MENU_ITEM}
              onClick={() => {
                close();
                setAvailabilityOpen(true);
              }}
            >
              <CalendarClock className="h-4 w-4" /> Set Availability
            </button>
          )}
          {canManageDriver && (
            <Link href={detailHref} onClick={close} className={MENU_ITEM}>
              <Car className="h-4 w-4" /> Manage Driver Profile
            </Link>
          )}
          {canManageRoles && hasAccount && (
            <Link href={rolesHref} onClick={close} className={MENU_ITEM}>
              <KeyRound className="h-4 w-4" /> Reset Access
            </Link>
          )}
          {canArchive && (
            <button
              type="button"
              className={`${MENU_ITEM} ${
                archived
                  ? 'text-brand-700 hover:text-brand-800'
                  : 'text-status-error-text hover:bg-red-50'
              }`}
              onClick={() => {
                close();
                if (archived) {
                  runLifecycle({ action: 'restore', reason: 'Restored from staff directory' });
                } else {
                  setArchiveOpen(true);
                }
              }}
            >
              {archived ? (
                <>
                  <RotateCcw className="h-4 w-4" /> Restore Employee
                </>
              ) : (
                <>
                  <Archive className="h-4 w-4" /> Archive
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Set Availability dialog */}
      <Dialog open={availabilityOpen} onOpenChange={setAvailabilityOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Set Availability</DialogTitle>
            <DialogDescription>
              Update the current availability status for {employeeName}. A history entry is
              recorded.
            </DialogDescription>
          </DialogHeader>
          <StyledSelect
            value={availability}
            onChange={(e) => setAvailability(e.target.value)}
            aria-label="Availability status"
          >
            <option value="available">Available</option>
            <option value="annual_leave">Annual leave</option>
            <option value="sick_leave">Sick leave</option>
            <option value="official_travel">Official travel</option>
            <option value="training">Training</option>
            <option value="off_duty">Off duty</option>
            <option value="temporarily_unavailable">Temporarily unavailable</option>
          </StyledSelect>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setAvailabilityOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              onClick={async () => {
                const ok = await runLifecycle({
                  action: 'availability',
                  status: availability,
                  reason: 'Updated from staff directory',
                });
                if (ok) setAvailabilityOpen(false);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive dialog */}
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Archive employee?</DialogTitle>
            <DialogDescription>
              Access and active assignments will be disabled. Historical records are preserved.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={archiveReason}
            onChange={(e) => setArchiveReason(e.target.value)}
            placeholder="Reason for archiving"
            rows={4}
            autoFocus
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setArchiveOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={busy}
              disabled={!archiveReason.trim()}
              onClick={async () => {
                const ok = await runLifecycle({
                  action: 'archive',
                  reason: archiveReason.trim(),
                });
                if (ok) {
                  setArchiveOpen(false);
                  setArchiveReason('');
                }
              }}
            >
              <Archive className="h-4 w-4" /> Archive employee
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
