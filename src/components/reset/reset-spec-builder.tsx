'use client';

import { CalendarClock, Database, Layers3, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, Label } from '@/components/ui/input';
import {
  RESET_ALWAYS_PROTECTED,
  RESET_CATEGORY_CATALOG,
  resolveResetCategories,
  type ResetCategoryId,
  type ResetPreset,
} from '@/lib/reset-catalog';

export interface ResetBuilderValue {
  preset: ResetPreset;
  categories: ResetCategoryId[];
  cutoff: string;
}

const PRESETS = [
  {
    id: 'operational' as const,
    label: 'Operational reset',
    description: 'The current safe preset for requests, trips and related operations.',
    icon: Database,
    tone: 'border-brand-200 bg-brand-50/40 dark:border-brand-900 dark:bg-brand-950/20',
  },
  {
    id: 'selective' as const,
    label: 'Selective cleanup',
    description: 'Choose business areas and optionally clean only older operations.',
    icon: Layers3,
    tone: 'border-status-warning-text/25 bg-status-warning-bg/20',
  },
  {
    id: 'clean_slate' as const,
    label: 'Tenant clean slate',
    description: 'Clear all tenant working data while retaining the protected tenant shell.',
    icon: ShieldAlert,
    tone: 'border-status-error-text/25 bg-status-error-bg/20',
  },
];

export function ResetSpecBuilder({
  value,
  onChange,
}: {
  value: ResetBuilderValue;
  onChange: (value: ResetBuilderValue) => void;
}) {
  const resolved = resolveResetCategories(value.categories);
  const effectiveCategories =
    value.preset === 'operational'
      ? (['operations'] as ResetCategoryId[])
      : value.preset === 'clean_slate'
        ? RESET_CATEGORY_CATALOG.map((category) => category.id)
        : resolved.categories;
  const autoIncluded = value.preset === 'selective' ? resolved.autoIncludedCategories : [];
  const usesCutoff =
    effectiveCategories.length > 0 &&
    effectiveCategories.every(
      (id) => RESET_CATEGORY_CATALOG.find((category) => category.id === id)?.supportsCutoff,
    );

  const selectPreset = (preset: ResetPreset) =>
    onChange({
      preset,
      categories:
        preset === 'operational'
          ? ['operations']
          : preset === 'clean_slate'
            ? RESET_CATEGORY_CATALOG.map((category) => category.id)
            : value.preset === 'selective' && value.categories.length
              ? value.categories
              : ['operations'],
      cutoff: preset === 'clean_slate' ? '' : value.cutoff,
    });

  const toggleCategory = (id: ResetCategoryId, checked: boolean) => {
    if (!checked && value.categories.length === 1 && value.categories[0] === id) return;
    const requested = checked
      ? [...new Set([...value.categories, id])]
      : value.categories.filter((category) => category !== id);
    onChange({ ...value, categories: requested });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3" aria-label="Reset preset">
        {PRESETS.map((preset) => {
          const Icon = preset.icon;
          const active = value.preset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={active}
              onClick={() => selectPreset(preset.id)}
              className={`focus-ring min-h-32 rounded-[9px] border p-3 text-left transition-[border-color,box-shadow] ${preset.tone} ${active ? 'ring-brand-600/35 ring-2' : 'hover:border-ink-300'}`}
            >
              <Icon className="text-ink-700 h-5 w-5" />
              <span className="text-ink-950 mt-3 block text-sm font-semibold">{preset.label}</span>
              <span className="text-ink-600 mt-1 block text-xs leading-relaxed">
                {preset.description}
              </span>
            </button>
          );
        })}
      </div>

      {value.preset === 'selective' && (
        <div className="space-y-2">
          <Label>Data to reset</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {RESET_CATEGORY_CATALOG.map((category) => {
              const requested = value.categories.includes(category.id);
              const included = effectiveCategories.includes(category.id);
              const automatic = included && !requested;
              return (
                <label
                  key={category.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-[8px] border p-3 ${included ? 'border-brand-300 bg-brand-50/30 dark:border-brand-900 dark:bg-brand-950/15' : 'border-border bg-surface'}`}
                >
                  <Checkbox
                    checked={included}
                    disabled={automatic}
                    onCheckedChange={(checked) => toggleCategory(category.id, checked === true)}
                    aria-label={category.label}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="text-ink-950 flex flex-wrap items-center gap-2 text-sm font-medium">
                      {category.label}
                      {automatic && (
                        <Badge variant="info" size="sm">
                          Required dependency
                        </Badge>
                      )}
                      {category.risk === 'critical' && (
                        <Badge variant="error" size="sm">
                          High impact
                        </Badge>
                      )}
                    </span>
                    <span className="text-ink-500 mt-1 block text-xs leading-relaxed">
                      {category.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {autoIncluded.length > 0 && (
            <p className="text-ink-500 text-xs">
              Dependencies are included automatically so retained records never point to removed
              data.
            </p>
          )}
        </div>
      )}

      {usesCutoff && value.preset !== 'clean_slate' && (
        <div className="border-border bg-muted/30 grid gap-3 rounded-[8px] border p-3 sm:grid-cols-[1fr_220px] sm:items-end">
          <div>
            <p className="text-ink-950 flex items-center gap-2 text-sm font-medium">
              <CalendarClock className="h-4 w-4" /> Historical cutoff
            </p>
            <p className="text-ink-500 mt-1 text-xs leading-relaxed">
              Leave blank to clear all selected records, or choose a date to include complete
              operation trees created before that date.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reset-cutoff">Older than</Label>
            <Input
              id="reset-cutoff"
              type="date"
              max={new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)}
              value={value.cutoff}
              onChange={(event) => onChange({ ...value, cutoff: event.target.value })}
            />
          </div>
        </div>
      )}

      <div className="border-status-success-text/20 bg-status-success-bg/20 rounded-[8px] border p-3">
        <p className="text-status-success-text text-xs font-semibold">Always protected</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {RESET_ALWAYS_PROTECTED.map((item) => (
            <Badge key={item} variant="success" size="sm">
              {item}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}
