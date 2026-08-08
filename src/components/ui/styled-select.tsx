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
  id?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  placeholder?: string;
  error?: string;
  wrapperClassName?: string;
  'aria-label'?: string;
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
  (
    {
      className,
      children,
      placeholder,
      error,
      wrapperClassName,
      value,
      defaultValue,
      onChange,
      id,
      name,
      disabled,
      required,
      'aria-label': ariaLabel,
    },
    ref,
  ) => {
    const parsed = React.useMemo(() => parseOptions(children), [children]);
    const resolvedPlaceholder = placeholder || parsed.emptyLabel || 'Select an option';
    const isControlled = value !== undefined;
    const [internalValue, setInternalValue] = React.useState(() =>
      defaultValue !== undefined ? String(defaultValue) : '',
    );
    const resolvedValue = isControlled ? String(value ?? '') : internalValue;
    const showUnfilteredOption =
      parsed.emptyLabel !== null ||
      (typeof resolvedPlaceholder === 'string' && /^all\b/i.test(resolvedPlaceholder));

    return (
      <div className={cn('relative', wrapperClassName)}>
        {name && <input type="hidden" name={name} value={resolvedValue} disabled={disabled} />}
        <SelectPrimitive.Root
          value={resolvedValue}
          disabled={disabled}
          required={required}
          onValueChange={(nextValue) => {
            const normalizedValue = nextValue === '__all_filters__' ? '' : nextValue;
            if (!isControlled) setInternalValue(normalizedValue);
            onChange?.({
              target: { value: normalizedValue },
              currentTarget: { value: normalizedValue },
            } as React.ChangeEvent<HTMLSelectElement>);
          }}
        >
          <SelectPrimitive.Trigger
            ref={ref}
            id={id}
            aria-label={ariaLabel}
            className={cn(
              'border-border bg-surface text-ink-950 focus:ring-brand-600 disabled:bg-muted flex h-10 w-full items-center justify-between rounded-[8px] border px-3 text-sm outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
              'data-[placeholder]:text-ink-500',
              error && 'border-status-error-text focus:ring-status-error-text',
              className,
            )}
          >
            <SelectPrimitive.Value placeholder={resolvedPlaceholder} />
            <SelectPrimitive.Icon asChild>
              <ChevronDown className="text-ink-400 h-4 w-4 shrink-0" />
            </SelectPrimitive.Icon>
          </SelectPrimitive.Trigger>
          <SelectPrimitive.Portal>
            <SelectPrimitive.Content
              position="popper"
              sideOffset={4}
              className="border-border bg-surface z-[100] max-h-[min(20rem,60dvh)] max-w-[calc(100vw-1.5rem)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[10px] border p-1 shadow-lg"
            >
              <SelectPrimitive.Viewport className="max-h-72 scrollbar-thin overflow-y-auto">
                {showUnfilteredOption && (
                  <SelectPrimitive.Item
                    value="__all_filters__"
                    className="text-ink-700 data-[highlighted]:bg-muted data-[highlighted]:text-ink-950 relative flex cursor-default items-center rounded-[6px] py-2 pr-3 pl-8 text-sm outline-none select-none"
                  >
                    <SelectPrimitive.ItemText>{resolvedPlaceholder}</SelectPrimitive.ItemText>
                  </SelectPrimitive.Item>
                )}
                {parsed.options.map((option) => (
                  <SelectOption key={option.value} option={option} />
                ))}
                {parsed.groups.map((group, index) => (
                  <SelectPrimitive.Group key={index}>
                    <SelectPrimitive.Label className="text-ink-500 px-3 py-2 text-[11px] font-semibold tracking-wide uppercase">
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
        {error && <p className="text-status-error-text mt-1 text-xs">{error}</p>}
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
      className="text-ink-700 data-[highlighted]:bg-muted data-[highlighted]:text-ink-950 relative flex cursor-default items-center rounded-[6px] py-2 pr-3 pl-8 text-sm outline-none select-none data-[disabled]:opacity-50"
    >
      <SelectPrimitive.ItemIndicator className="absolute left-2">
        <Check className="text-brand-700 h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

/**
 * StyledNativeDate - date input styled to match the Select component.
 */
export interface StyledDateInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
}

const StyledDateInput = React.forwardRef<HTMLInputElement, StyledDateInputProps>(
  ({ className, error, type = 'date', ...props }, ref) => {
    const isControlled = props.value !== undefined;
    const [internalValue, setInternalValue] = React.useState(() =>
      String(props.defaultValue ?? ''),
    );
    const resolvedValue = isControlled ? String(props.value ?? '') : internalValue;

    const emitChange = (nextValue: string) => {
      if (!isControlled) {
        setInternalValue(nextValue);
      }
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
            value={resolvedValue}
            disabled={props.disabled}
          />
          <DatePicker
            value={resolvedValue}
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
            value={resolvedValue}
            disabled={props.disabled}
          />
          <TimePicker
            value={resolvedValue}
            onChange={emitChange}
            disabled={props.disabled}
            className={className}
          />
          {error && <p className="text-status-error-text mt-1 text-xs">{error}</p>}
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
            value={resolvedValue}
            disabled={props.disabled}
          />
          <DateTimePicker
            value={resolvedValue}
            onChange={emitChange}
            min={typeof props.min === 'string' ? props.min : undefined}
            max={typeof props.max === 'string' ? props.max : undefined}
            disabled={props.disabled}
            className={className}
          />
          {error && <p className="text-status-error-text mt-1 text-xs">{error}</p>}
        </div>
      );
    }

    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          'border-border bg-surface text-ink-950 placeholder:text-ink-400 focus:ring-brand-600 disabled:bg-muted h-10 w-full rounded-[8px] border px-3 text-sm [color-scheme:light] focus:ring-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:[color-scheme:dark]',
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
