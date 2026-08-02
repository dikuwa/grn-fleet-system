'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { StyledSelect } from '@/components/ui/styled-select';
import { useToast } from '@/lib/use-toast';
import {
  Archive,
  RotateCcw,
  Save,
  MoreHorizontal,
  KeyRound,
  Ban,
  Car,
} from 'lucide-react';
import { Textarea } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AVAILABILITY_OPTIONS } from '@/lib/employee-status';

export interface EmployeeLifecycleActionsProps {
  employeeId: string;
  employeeName: string;
  archived: boolean;
  hasAccount: boolean;
  isDriver: boolean;
}

const MENU_ITEM =
  'text-ink-700 hover:bg-muted hover:text-ink-950 flex w-full items-center gap-2.5 rounded-[6px] px-3 py-2 text-left text-sm transition-colors';

export function EmployeeLifecycleActions({
  employeeId,
  employeeName,
  archived,
  hasAccount,
  isDriver,
}: EmployeeLifecycleActionsProps) {
  const [availability, setAvailability] = useState('available');
  const [staffStatus, setStaffStatus] = useState(archived ? 'archived' : 'active');
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountAction, setAccountAction] = useState<'deactivate' | 'reactivate'>('deactivate');
  const [driverOpen, setDriverOpen] = useState(false);
  const [driverReason, setDriverReason] = useState('');
  const router = useRouter();
  const { toast } = useToast();

  async function update(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch(`/api/employees/${employeeId}/lifecycle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        toast({ title: 'Employee not updated', description: data.error, variant: 'error' });
        return false;
      }
      toast({ title: 'Employee updated', variant: 'success' });
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function changeStaffStatus() {
    const ok = await update({ action: 'status', status: staffStatus });
    if (ok) setMenuOpen(false);
  }

  async function confirmArchive() {
    const ok = await update({ action: 'archive', reason: archiveReason.trim() });
    if (ok) {
      setArchiveOpen(false);
      setArchiveReason('');
      setMenuOpen(false);
    }
  }

  async function confirmAccount() {
    const ok = await update({
      action: accountAction === 'deactivate' ? 'deactivate_account' : 'reactivate_account',
      reason: 'Managed from employee profile',
    });
    if (ok) {
      setAccountOpen(false);
      setMenuOpen(false);
    }
  }

  async function confirmRemoveDriver() {
    const ok = await update({
      action: 'remove_driver',
      reason: driverReason.trim() || 'Driver designation removed from employee profile',
    });
    if (ok) {
      setDriverOpen(false);
      setDriverReason('');
      setMenuOpen(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Availability control */}
      {!archived && (
        <>
          <StyledSelect
            value={availability}
            onChange={(event) => setAvailability(event.target.value)}
            aria-label="Availability status"
            className="w-auto"
          >
            {AVAILABILITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </StyledSelect>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              update({ action: 'availability', status: availability, reason: 'Updated from employee profile' })
            }
          >
            <Save className="h-4 w-4" />Set availability
          </Button>

          {/* Staff status control — routine status only; archive is destructive */}
          <StyledSelect
            value={staffStatus}
            onChange={(event) => setStaffStatus(event.target.value)}
            aria-label="Employment status"
            className="w-auto"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </StyledSelect>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || staffStatus === (archived ? 'archived' : 'active')}
            onClick={changeStaffStatus}
          >
            Mark {staffStatus === 'active' ? 'Active' : 'Inactive'}
          </Button>
        </>
      )}

      {/* More actions (destructive / account / driver) */}
      <div className="relative">
        <Button
          size="sm"
          variant="tertiary"
          aria-label="More actions"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
        {menuOpen && (
          <div className="border-border bg-surface absolute right-0 z-50 mt-1 w-64 rounded-[10px] border p-1.5 shadow-lg">
            {archived ? (
              <button
                type="button"
                className={MENU_ITEM}
                onClick={async () => {
                  const ok = await update({ action: 'restore', reason: 'Restored by authorised administrator' });
                  if (ok) setMenuOpen(false);
                }}
              >
                <RotateCcw className="h-4 w-4" /> Restore Employee
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={`${MENU_ITEM} text-status-error-text hover:bg-red-50 dark:hover:bg-red-500/10`}
                  onClick={() => {
                    setMenuOpen(false);
                    setArchiveOpen(true);
                  }}
                >
                  <Archive className="h-4 w-4" /> Archive Employee
                </button>
                {hasAccount && (
                  <button
                    type="button"
                    className={MENU_ITEM}
                    onClick={() => {
                      setAccountAction('deactivate');
                      setMenuOpen(false);
                      setAccountOpen(true);
                    }}
                  >
                    <Ban className="h-4 w-4" /> Deactivate Linked Account
                  </button>
                )}
                {hasAccount && (
                  <button
                    type="button"
                    className={MENU_ITEM}
                    onClick={() => {
                      setAccountAction('reactivate');
                      setMenuOpen(false);
                      setAccountOpen(true);
                    }}
                  >
                    <KeyRound className="h-4 w-4" /> Reactivate Linked Account
                  </button>
                )}
                {isDriver && (
                  <button
                    type="button"
                    className={MENU_ITEM}
                    onClick={() => {
                      setMenuOpen(false);
                      setDriverOpen(true);
                    }}
                  >
                    <Car className="h-4 w-4" /> Remove Driver Designation
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Archive dialog */}
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Archive employee?</DialogTitle>
            <DialogDescription>
              Access and active assignments will be disabled. Historical records are preserved. Record the reason
              for the audit trail.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={archiveReason}
            onChange={(event) => setArchiveReason(event.target.value)}
            placeholder="Reason for archiving"
            rows={4}
            autoFocus
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setArchiveOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              loading={busy}
              disabled={!archiveReason.trim()}
              onClick={confirmArchive}
            >
              <Archive className="h-4 w-4" /> Archive employee
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Account status dialog */}
      <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {accountAction === 'deactivate' ? 'Deactivate linked account?' : 'Reactivate linked account?'}
            </DialogTitle>
            <DialogDescription>
              {accountAction === 'deactivate'
                ? `${employeeName} will be unable to sign in. Staff status and availability are not affected.`
                : `${employeeName} will regain sign-in access. Staff status and availability are not affected.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAccountOpen(false)}>Cancel</Button>
            <Button
              variant={accountAction === 'deactivate' ? 'destructive' : 'primary'}
              loading={busy}
              onClick={confirmAccount}
            >
              {accountAction === 'deactivate' ? 'Deactivate account' : 'Reactivate account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove driver dialog */}
      <Dialog open={driverOpen} onOpenChange={setDriverOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove driver designation?</DialogTitle>
            <DialogDescription>
              The linked driver profile will be revoked and {employeeName} will no longer be eligible for driving
              assignments.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={driverReason}
            onChange={(event) => setDriverReason(event.target.value)}
            placeholder="Reason for removing driver designation"
            rows={3}
            autoFocus
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDriverOpen(false)}>Cancel</Button>
            <Button variant="destructive" loading={busy} onClick={confirmRemoveDriver}>
              <Car className="h-4 w-4" /> Remove driver
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
