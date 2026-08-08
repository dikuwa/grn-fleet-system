'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive' | 'emergency';
  onConfirm: () => void | Promise<void>;
  requireTypedConfirm?: string;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  requireTypedConfirm,
}: ConfirmDialogProps) {
  const [loading, setLoading] = useState(false);
  const [typedValue, setTypedValue] = useState('');

  useEffect(() => {
    if (!open) setTypedValue('');
  }, [open]);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  const canConfirm = requireTypedConfirm ? typedValue === requireTypedConfirm : true;
  const isCritical = variant === 'destructive' || variant === 'emergency';

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !loading && onOpenChange(nextOpen)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          {isCritical ? (
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-status-error-bg text-status-error-text">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </div>
          ) : null}
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {requireTypedConfirm && (
          <div className="space-y-2">
            <label htmlFor="confirm-dialog-value" className="text-xs text-ink-500">
              Type <span className="font-semibold text-ink-700">{requireTypedConfirm}</span> to confirm:
            </label>
            <Input
              id="confirm-dialog-value"
              value={typedValue}
              onChange={(event) => setTypedValue(event.target.value)}
              placeholder={requireTypedConfirm}
              autoComplete="off"
              disabled={loading}
              error={typedValue.length > 0 && !canConfirm}
            />
          </div>
        )}

        <DialogFooter className="mobile-action-bar">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={
              variant === 'destructive'
                ? 'destructive'
                : variant === 'emergency'
                  ? 'emergency'
                  : 'primary'
            }
            onClick={handleConfirm}
            loading={loading}
            disabled={!canConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useConfirm() {
  const [state, setState] = useState<{
    open: boolean;
    props: Omit<ConfirmDialogProps, 'open' | 'onOpenChange'>;
  }>({ open: false, props: { title: '', description: '', onConfirm: () => {} } });

  const confirm = (props: Omit<ConfirmDialogProps, 'open' | 'onOpenChange'>) => {
    setState({ open: true, props });
  };

  const dialog = (
    <ConfirmDialog
      open={state.open}
      onOpenChange={(open) => setState((current) => ({ ...current, open }))}
      {...state.props}
    />
  );

  return { confirm, dialog };
}
