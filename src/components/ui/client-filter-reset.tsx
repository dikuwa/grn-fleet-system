'use client';

import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ClientFilterReset({
  isFiltered,
  onClear,
  label = 'Clear filters',
}: {
  isFiltered: boolean;
  onClear: () => void;
  label?: string;
}) {
  if (!isFiltered) return null;

  return (
    <Button type="button" variant="tertiary" size="sm" onClick={onClear}>
      <RotateCcw className="h-4 w-4" />
      {label}
    </Button>
  );
}
