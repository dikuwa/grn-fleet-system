'use client';

import { useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const PERSONAS = [
  {
    key: 'transport',
    title: 'Transport Officer',
    description: 'Review requests, manage vehicles and work through fleet allocation.',
  },
  {
    key: 'requester',
    title: 'Requester',
    description: 'Create a transport request and follow the real request workflow.',
  },
  {
    key: 'approver',
    title: 'Approver',
    description: 'See the approval queue and make role-based request decisions.',
  },
  {
    key: 'driver',
    title: 'Driver',
    description: 'Explore driver trips, logbook, fuel and incident workflows.',
  },
] as const;

export function DemoRolePicker() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function start(persona: string) {
    setBusy(persona);
    setError('');
    try {
      const response = await fetch('/api/public/demo/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'The live demo could not be started.');
        return;
      }
      window.location.assign(data.redirectTo || '/dashboard');
    } catch {
      setError('The live demo could not be started. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-[8px] border border-status-error-text/20 bg-status-error-bg p-3 text-sm text-status-error-text">
          {error}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {PERSONAS.map((persona) => (
          <div
            key={persona.key}
            className="flex min-h-44 flex-col rounded-[10px] border border-border bg-surface p-5 shadow-sm"
          >
            <div className="flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Explore as</p>
              <h2 className="mt-2 text-lg font-semibold text-ink-950">{persona.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-500">{persona.description}</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="mt-5 w-full justify-between"
              disabled={busy !== null}
              onClick={() => void start(persona.key)}
            >
              <span>{busy === persona.key ? 'Opening workspace…' : `Explore ${persona.title}`}</span>
              {busy === persona.key ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
