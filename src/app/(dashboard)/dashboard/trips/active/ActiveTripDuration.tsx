'use client';

import { useState, useEffect, useRef } from 'react';
import { Clock } from 'lucide-react';

function formatDuration(startedAt: string | null): string {
  if (!startedAt) return '—';
  const diffMs = Date.now() - new Date(startedAt).getTime();
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
  if (minutes > 0) return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  return `${seconds}s`;
}

export function ActiveTripDuration({ tripId, startedAt }: { tripId: string; startedAt: string | null }) {
  const [duration, setDuration] = useState(() => formatDuration(startedAt));
  const startedRef = useRef(startedAt);
  startedRef.current = startedAt;

  useEffect(() => {
    if (!startedAt) return;

    // Immediate update
    setDuration(formatDuration(startedAt));

    // Update every second for live feel
    const timer = setInterval(() => {
      setDuration(formatDuration(startedRef.current));
    }, 1_000);

    return () => clearInterval(timer);
  }, [startedAt]);

  if (!startedAt) return null;

  return (
    <span className="inline-flex items-center gap-1 text-xs text-status-info-text font-medium tabular-nums" title={`Trip ${tripId.slice(0, 8)}…`}>
      <Clock className="h-3 w-3" /> {duration}
    </span>
  );
}
