'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
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

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  const canConfirm = requireTypedConfirm
    ? typedValue === requireTypedConfirm
    : true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          {variant === 'destructive' || variant === 'emergency' ? (
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-status-error-bg text-status-error-text">
              <AlertTriangle className="h-5 w-5" />
            </div>
          ) : null}
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {requireTypedConfirm && (
          <div className="space-y-2">
            <p className="text-xs text-ink-500">
              Type <span className="font-semibold text-ink-700">{requireTypedConfirm}</span> to confirm:
            </p>
            <input
              type="text"
              value={typedValue}
              onChange={(e) => setTypedValue(e.target.value)}
              className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-status-error-text"
              placeholder={requireTypedConfirm}
            />
          </div>
        )}

        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
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

/**
 * Hook for managing confirm dialog state
 */
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
      onOpenChange={(open) => setState((s) => ({ ...s, open }))}
      {...state.props}
    />
  );

  return { confirm, dialog };
}
