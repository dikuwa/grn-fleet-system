'use client';

/**
 * useToast — compatibility adapter on top of react-hot-toast.
 *
 * Keeps the existing `{ toast, dismiss }` surface so all call sites continue
 * to work without changes.  Delegate every variant to react-hot-toast so the
 * old manual DOM engine is no longer needed.
 *
 * Usage (unchanged from before):
 *   const { toast } = useToast();
 *   toast({ title: 'Saved', description: 'Changes applied.', variant: 'success' });
 */

import React, { useCallback, useMemo } from 'react';
import hotToast from 'react-hot-toast';

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: 'default' | 'success' | 'error' | 'pending';
  duration?: number;
}

function buildContent(title: string, description?: string): React.ReactElement {
  if (!description) {
    return React.createElement('span', { className: 'text-sm font-semibold' }, title);
  }
  return React.createElement(
    'div',
    null,
    React.createElement('p', { className: 'text-sm font-semibold leading-snug' }, title),
    React.createElement('p', { className: 'mt-0.5 text-sm opacity-80 leading-snug' }, description),
  );
}

export function useToast() {
  const toast = useCallback(({ title, description, variant = 'default', duration = 4000 }: ToastOptions) => {
    const content = buildContent(title, description);
    switch (variant) {
      case 'success':
        return hotToast.success(content, { duration });
      case 'error':
        return hotToast.error(content, { duration });
      case 'pending':
        return hotToast.loading(content, { duration });
      default:
        return hotToast(content, { duration });
    }
  }, []);

  return useMemo(() => ({ toast, dismiss: hotToast.dismiss }), [toast]);
}
