'use client';

import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';

interface TimePickerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  minuteStep?: number;
}

export function TimePicker({
  value,
  onChange,
  disabled,
  className,
  minuteStep = 5,
}: TimePickerProps) {
  const [hour = '', minute = ''] = value.split(':');
  const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
  const standardMinutes = Array.from(
    { length: Math.ceil(60 / minuteStep) },
    (_, index) => String(index * minuteStep).padStart(2, '0'),
  );
  const minutes = minute && !standardMinutes.includes(minute)
    ? [...standardMinutes, minute].sort()
    : standardMinutes;

  const update = (nextHour: string, nextMinute: string) => {
    if (!nextHour && !nextMinute) onChange('');
    else onChange(`${nextHour || '00'}:${nextMinute || '00'}`);
  };

  return (
    <div className={cn('grid grid-cols-[1fr_auto_1fr_auto] items-center gap-1.5', className)}>
      <Select value={hour} onValueChange={(next) => update(next, minute)} disabled={disabled}>
        <SelectTrigger aria-label="Hour">
          <SelectValue placeholder="HH" />
        </SelectTrigger>
        <SelectContent>
          {hours.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
        </SelectContent>
      </Select>
      <span className="text-sm font-semibold text-ink-500">:</span>
      <Select value={minute} onValueChange={(next) => update(hour, next)} disabled={disabled}>
        <SelectTrigger aria-label="Minute">
          <SelectValue placeholder="MM" />
        </SelectTrigger>
        <SelectContent>
          {minutes.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
        </SelectContent>
      </Select>
      <Clock className="h-4 w-4 text-ink-400" aria-hidden="true" />
    </div>
  );
}

interface DateTimePickerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  min?: string;
  max?: string;
  className?: string;
}

export function DateTimePicker({
  value,
  onChange,
  disabled,
  min,
  max,
  className,
}: DateTimePickerProps) {
  const [date = '', time = ''] = value.split('T');
  const update = (nextDate: string, nextTime: string) => {
    if (!nextDate && !nextTime) onChange('');
    else if (nextDate || date) onChange(`${nextDate || date}T${nextTime || time || '00:00'}`);
  };

  return (
    <div className={cn('grid gap-2 sm:grid-cols-2', className)}>
      <DatePicker
        value={date}
        onChange={(nextDate) => update(nextDate, time)}
        disabled={disabled}
        min={min?.split('T')[0]}
        max={max?.split('T')[0]}
        placeholder="Select date…"
      />
      <TimePicker
        value={time?.slice(0, 5) || ''}
        onChange={(nextTime) => update(date, nextTime)}
        disabled={disabled}
      />
    </div>
  );
}
