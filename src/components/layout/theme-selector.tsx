'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/lib/theme-provider';
import { cn } from '@/lib/utils';

const options = [
  { value: 'light' as const, label: 'Light', icon: Sun },
  { value: 'dark' as const, label: 'Dark', icon: Moon },
  { value: 'system' as const, label: 'System', icon: Monitor },
];

export function ThemeSelector({ className }: { className?: string }) {
  const { resolvedTheme, theme, setTheme } = useTheme();
  const TriggerIcon = theme === 'system' ? Monitor : resolvedTheme === 'dark' ? Moon : Sun;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            'focus-ring flex h-10 w-10 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-muted hover:text-ink-950',
            className,
          )}
          title={`Theme: ${theme}`}
          aria-label={`Select theme. Current preference: ${theme}.`}
        >
          <TriggerIcon className="h-[18px] w-[18px] theme-icon-enter" aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-[100] min-w-44 rounded-[10px] border border-border bg-surface p-1 shadow-lg outline-none"
        >
          <DropdownMenu.Label className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
            Appearance
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={theme}
            onValueChange={(value) => setTheme(value as 'light' | 'dark' | 'system')}
          >
            {options.map(({ value, label, icon: Icon }) => (
              <DropdownMenu.RadioItem
                key={value}
                value={value}
                className="relative flex cursor-default select-none items-center gap-2 rounded-[6px] px-3 py-2 pr-8 text-sm text-ink-700 outline-none data-[highlighted]:bg-muted data-[highlighted]:text-ink-950"
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{label}</span>
                <DropdownMenu.ItemIndicator className="absolute right-2.5">
                  <Check className="h-4 w-4 text-brand-700" aria-hidden="true" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
