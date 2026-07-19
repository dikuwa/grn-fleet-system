'use client';

import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

interface DurationData {
  id: string;
  startedAt: string | null;
}

function getDuration(startedAt: string | null): string {
  if (!startedAt) return '—';
  const diffMs = Date.now() - new Date(startedAt).getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function ActiveTripDuration({ tripId, startedAt }: { tripId: string; startedAt: string | null }) {
  const [duration, setDuration] = useState(() => getDuration(startedAt));

  useEffect(() => {
    if (!startedAt) return;

    const timer = setInterval(() => {
      setDuration(getDuration(startedAt));
    }, 60_000);

    return () => clearInterval(timer);
  }, [startedAt]);

  if (!startedAt) return null;

  return (
    <span className="inline-flex items-center gap-1 text-xs text-status-info-text font-medium">
      <Clock className="h-3 w-3" /> {duration}
    </span>
  );
}
