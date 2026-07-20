'use client';

/**
 * useToast — lightweight hook for showing toast notifications.
 *
 * Usage:
 *   const { toast } = useToast();
 *   toast({ title: 'Saved', description: 'Your changes have been saved.', variant: 'success' });
 *
 * The toast markup assumes the consumer renders a fixed-position container
 * (see src/app/(dashboard)/layout.tsx or the main layout) with inline
 * <div id="toast-container"></div> so we can append toast elements.
 *
 * For the simplest integration, this module creates toast DOM elements directly
 * and appends them to a known container. If the container doesn't exist it
 * falls back to document.body.
 */

import { useCallback, useRef, useEffect } from 'react';

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: 'default' | 'success' | 'error' | 'pending';
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: string;
}

function getContainer(): HTMLElement {
  return document.getElementById('toast-container') || document.body;
}

// Style map is kept as a self-contained mapping so there is no coupling
// to the Tailwind theme tokens. Consumers can override via className.
const BG_MAP: Record<string, string> = {
  default: 'bg-surface border-border text-ink-950',
  success: 'bg-status-success-bg border-status-success-bg text-status-success-text',
  error: 'bg-status-error-bg border-status-error-bg text-status-error-text',
  pending: 'bg-status-pending-bg border-status-pending-bg text-status-pending-text',
};

function createToastElement(item: ToastItem): HTMLDivElement {
  const toast = document.createElement('div');
  const bg = BG_MAP[item.variant || 'default'];
  toast.id = `toast-${item.id}`;
  toast.className = `${bg} pointer-events-auto flex w-full items-start gap-3 rounded-[10px] border p-4 shadow-lg transition-all duration-300`;

  // Inner structure
  const body = document.createElement('div');
  body.className = 'flex-1 min-w-0';

  const titleEl = document.createElement('p');
  titleEl.className = 'text-sm font-semibold';
  titleEl.textContent = item.title;
  body.appendChild(titleEl);

  if (item.description) {
    const descEl = document.createElement('p');
    descEl.className = 'mt-0.5 text-sm opacity-90';
    descEl.textContent = item.description;
    body.appendChild(descEl);
  }

  toast.appendChild(body);

  // Close button
  const close = document.createElement('button');
  close.className = 'shrink-0 rounded-md p-1 opacity-60 hover:opacity-100 transition-opacity';
  close.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  close.setAttribute('aria-label', 'Dismiss');
  close.addEventListener('click', () => removeToast(item.id));
  toast.appendChild(close);

  // Entrance animation
  const animateIn = [
    { opacity: 0, transform: 'translateY(12px) scale(0.96)' },
    { opacity: 1, transform: 'translateY(0) scale(1)' },
  ];
  toast.animate(animateIn, { duration: 200, easing: 'ease-out' });

  return toast;
}

function removeToast(id: string) {
  const el = document.getElementById(`toast-${id}`);
  if (!el) return;
  const out = el.animate(
    [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-8px)' }],
    { duration: 150, easing: 'ease-in' },
  );
  out.onfinish = () => el.remove();
}

let counter = 0;

export function useToast() {
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Cleanup timers on unmount
  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const t of all.values()) clearTimeout(t);
      all.clear();
    };
  }, []);

  const toast = useCallback((opts: ToastOptions) => {
    const id = `t${++counter}_${Date.now()}`;
    const item: ToastItem = { id, ...opts };

    const container = getContainer();
    const el = createToastElement(item);
    container.appendChild(el);

    // Auto-dismiss
    const dur = opts.duration ?? 4000;
    const timer = setTimeout(() => removeToast(id), dur);
    timers.current.set(id, timer);
  }, []);

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    removeToast(id);
  }, []);

  return { toast, dismiss };
}
