'use client';

/**
 * Tiny external selection store shared by the Staff Directory bulk bar and
 * per-row checkboxes. Kept out of React state so the server-rendered rows can
 * toggle a single client-side selection without lifting state up.
 */
type Listener = () => void;

let selectedIds = new Set<string>();
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): ReadonlySet<string> {
  return selectedIds;
}

export function toggleId(id: string) {
  const next = new Set(selectedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds = next;
  emit();
}

export function setSelected(ids: Iterable<string>) {
  selectedIds = new Set(ids);
  emit();
}

export function clearSelection() {
  if (selectedIds.size === 0) return;
  selectedIds = new Set();
  emit();
}

export function isSelected(id: string) {
  return selectedIds.has(id);
}

export function getSelectedIds(): string[] {
  return Array.from(selectedIds);
}
