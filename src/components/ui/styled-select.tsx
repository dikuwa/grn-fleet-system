'use client';

import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DatePicker } from '@/components/ui/date-picker';
import { DateTimePicker, TimePicker } from '@/components/ui/time-picker';

/**
 * Theme-aware Radix select that retains the old select-like API used across
 * the application. Radix supplies the hidden form field when `name` is set,
 * so URL-backed GET filter forms continue to work without native browser UI.
 */
export interface StyledSelectProps {
  children?: React.ReactNode;
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  placeholder?: string;
  error?: string;
  wrapperClassName?: string;
}

interface ParsedOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

interface ParsedGroup {
  label: React.ReactNode;
  options: ParsedOption[];
}

function parseOptions(children: React.ReactNode) {
  const options: ParsedOption[] = [];
  const groups: ParsedGroup[] = [];
  let emptyLabel: React.ReactNode = null;

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const props = child.props as {
      value?: string | number;
      disabled?: boolean;
      label?: React.ReactNode;
      children?: React.ReactNode;
    };
    if (child.type === 'option') {
      const value = String(props.value ?? '');
      if (!value) {
        emptyLabel = props.children;
      } else {
        options.push({ value, label: props.children, disabled: props.disabled });
      }
      return;
    }
    if (child.type === 'optgroup') {
      const groupOptions: ParsedOption[] = [];
      React.Children.forEach(props.children, (optionChild) => {
        if (!React.isValidElement(optionChild) || optionChild.type !== 'option') return;
        const optionProps = optionChild.props as {
          value?: string | number;
          disabled?: boolean;
          children?: React.ReactNode;
        };
        const value = String(optionProps.value ?? '');
        if (value) {
          groupOptions.push({
            value,
            label: optionProps.children,
            disabled: optionProps.disabled,
          });
        }
      });
      groups.push({ label: props.label, options: groupOptions });
    }
  });

  return { options, groups, emptyLabel };
}

const StyledSelect = React.forwardRef<HTMLButtonElement, StyledSelectProps>(
  ({
    className,
    children,
    placeholder,
    error,
    wrapperClassName,
    value,
    defaultValue,
    onChange,
    name,
    disabled,
    required,
  }, ref) => {
    const parsed = React.useMemo(() => parseOptions(children), [children]);
    const resolvedPlaceholder = placeholder || parsed.emptyLabel || 'Select an option';
    const controlledProps = value !== undefined
      ? { value: String(value) }
      : { defaultValue: defaultValue !== undefined ? String(defaultValue) : undefined };

    return (
      <div className={cn('relative', wrapperClassName)}>
        <SelectPrimitive.Root
          {...controlledProps}
          name={name}
          disabled={disabled}
          required={required}
          onValueChange={(nextValue) => {
            onChange?.({
              target: { value: nextValue },
              currentTarget: { value: nextValue },
            } as React.ChangeEvent<HTMLSelectElement>);
          }}
        >
          <SelectPrimitive.Trigger
            ref={ref}
          className={cn(
            'flex h-10 w-full items-center justify-between rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 outline-none focus:ring-2 focus:ring-brand-600 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50',
            'data-[placeholder]:text-ink-500',
            error && 'border-status-error-text focus:ring-status-error-text',
            className,
          )}
          >
            <SelectPrimitive.Value placeholder={resolvedPlaceholder} />
            <SelectPrimitive.Icon asChild>
              <ChevronDown className="h-4 w-4 shrink-0 text-ink-400" />
            </SelectPrimitive.Icon>
          </SelectPrimitive.Trigger>
          <SelectPrimitive.Portal>
            <SelectPrimitive.Content
              position="popper"
              sideOffset={4}
              className="z-[100] max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[10px] border border-border bg-surface p-1 shadow-lg"
            >
              <SelectPrimitive.Viewport className="scrollbar-thin max-h-72 overflow-y-auto">
                {parsed.options.map((option) => (
                  <SelectOption key={option.value} option={option} />
                ))}
                {parsed.groups.map((group, index) => (
                  <SelectPrimitive.Group key={index}>
                    <SelectPrimitive.Label className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                      {group.label}
                    </SelectPrimitive.Label>
                    {group.options.map((option) => (
                      <SelectOption key={option.value} option={option} />
                    ))}
                  </SelectPrimitive.Group>
                ))}
              </SelectPrimitive.Viewport>
            </SelectPrimitive.Content>
          </SelectPrimitive.Portal>
        </SelectPrimitive.Root>
        {error && <p className="mt-1 text-xs text-status-error-text">{error}</p>}
      </div>
    );
  },
);
StyledSelect.displayName = 'StyledSelect';

function SelectOption({ option }: { option: ParsedOption }) {
  return (
    <SelectPrimitive.Item
      value={option.value}
      disabled={option.disabled}
      className="relative flex cursor-default select-none items-center rounded-[6px] py-2 pl-8 pr-3 text-sm text-ink-700 outline-none data-[highlighted]:bg-muted data-[highlighted]:text-ink-950 data-[disabled]:opacity-50"
    >
      <SelectPrimitive.ItemIndicator className="absolute left-2">
        <Check className="h-4 w-4 text-brand-700" />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

/**
 * StyledNativeDate - date input styled to match the Select component.
 */
export interface StyledDateInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
}

const StyledDateInput = React.forwardRef<HTMLInputElement, StyledDateInputProps>(
  ({ className, error, type = 'date', ...props }, ref) => {
    const emitChange = (nextValue: string) => {
      props.onChange?.({
        target: { value: nextValue },
        currentTarget: { value: nextValue },
      } as React.ChangeEvent<HTMLInputElement>);
    };

    if (type === 'date') {
      return (
        <>
          <input
            ref={ref}
            type="hidden"
            name={props.name}
            value={String(props.value ?? props.defaultValue ?? '')}
            disabled={props.disabled}
          />
          <DatePicker
            value={String(props.value ?? props.defaultValue ?? '')}
            onChange={emitChange}
            min={typeof props.min === 'string' ? props.min : undefined}
            max={typeof props.max === 'string' ? props.max : undefined}
            disabled={props.disabled}
            required={props.required}
            error={error}
            className={className}
          />
        </>
      );
    }

    if (type === 'time') {
      return (
        <div>
          <input
            ref={ref}
            type="hidden"
            name={props.name}
            value={String(props.value ?? props.defaultValue ?? '')}
            disabled={props.disabled}
          />
          <TimePicker
            value={String(props.value ?? props.defaultValue ?? '')}
            onChange={emitChange}
            disabled={props.disabled}
            className={className}
          />
          {error && <p className="mt-1 text-xs text-status-error-text">{error}</p>}
        </div>
      );
    }

    if (type === 'datetime-local') {
      return (
        <div>
          <input
            ref={ref}
            type="hidden"
            name={props.name}
            value={String(props.value ?? props.defaultValue ?? '')}
            disabled={props.disabled}
          />
          <DateTimePicker
            value={String(props.value ?? props.defaultValue ?? '')}
            onChange={emitChange}
            min={typeof props.min === 'string' ? props.min : undefined}
            max={typeof props.max === 'string' ? props.max : undefined}
            disabled={props.disabled}
            className={className}
          />
          {error && <p className="mt-1 text-xs text-status-error-text">{error}</p>}
        </div>
      );
    }

    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          'h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted [color-scheme:light] dark:[color-scheme:dark]',
          error && 'border-status-error-text focus:ring-status-error-text',
          className,
        )}
        {...props}
      />
    );
  },
);
StyledDateInput.displayName = 'StyledDateInput';

export { StyledSelect, StyledDateInput };
