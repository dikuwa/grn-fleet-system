'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StyledSelect } from '@/components/ui/styled-select';
import { useToast } from '@/lib/use-toast';

export interface VehicleCategoryOption {
  id: string;
  name: string;
}

export function VehicleCategoryPicker({
  categories,
  value,
  onChange,
  onCategoriesChange,
}: {
  categories: VehicleCategoryOption[];
  value: string;
  onChange: (value: string) => void;
  onCategoriesChange: (categories: VehicleCategoryOption[]) => void;
}) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');

  const saveCategory = async () => {
    const normalizedName = name.trim();
    if (normalizedName.length < 2) return;
    setSaving(true);
    try {
      const response = await fetch('/api/vehicle-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: normalizedName }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.category) {
        throw new Error(body.error || 'Could not add the fleet category.');
      }
      const category = body.category as VehicleCategoryOption;
      const next = [...categories.filter((item) => item.id !== category.id), category].sort(
        (a, b) => a.name.localeCompare(b.name),
      );
      onCategoriesChange(next);
      onChange(category.id);
      setName('');
      setAdding(false);
      toast({
        title: 'Fleet category added',
        description: `${category.name} is now available for this tenant.`,
        variant: 'success',
      });
    } catch (error) {
      toast({
        title: 'Category not added',
        description: error instanceof Error ? error.message : 'Could not add the fleet category.',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <StyledSelect
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Select category…"
      >
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </StyledSelect>
      {adding ? (
        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void saveCategory();
              }
            }}
            maxLength={80}
            placeholder="Custom category name"
            className="border-border bg-surface text-ink-950 focus:ring-brand-600 h-10 min-w-0 flex-1 rounded-[8px] border px-3 text-sm focus:ring-2 focus:outline-none"
            autoFocus
          />
          <Button
            type="button"
            size="sm"
            loading={saving}
            onClick={() => void saveCategory()}
            disabled={name.trim().length < 2}
          >
            Add
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Cancel custom category"
            onClick={() => {
              setAdding(false);
              setName('');
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          className="text-brand-700 hover:text-brand-800 inline-flex items-center gap-1 text-xs font-medium"
          onClick={() => setAdding(true)}
        >
          <Plus className="h-3.5 w-3.5" /> Add custom category
        </button>
      )}
    </div>
  );
}
