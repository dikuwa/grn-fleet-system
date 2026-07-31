'use client';

import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { MapPin } from 'lucide-react';

export type PlaceSelection = {
  /** Formatted address / place name shown in the input. */
  name: string;
  placeId: string;
  lat: number;
  lng: number;
};

interface PlacesAutocompleteProps {
  value: string;
  onSelect: (place: PlaceSelection) => void;
  onTextChange?: (text: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** ISO country code for the Places autocomplete bias. Defaults to NA (Namibia). */
  countryCode?: string;
}

declare global {
  interface Window {
    google?: {
      maps?: {
        event?: {
          clearInstanceListeners?: (instance: unknown) => void;
        };
        places?: {
          Autocomplete?: new (
            input: HTMLInputElement,
            opts?: {
              fields?: string[];
              types?: string[];
              componentRestrictions?: { country: string };
            },
          ) => {
            addListener: (event: string, cb: () => void) => void;
            getPlace: () => {
              place_id?: string;
              formatted_address?: string;
              name?: string;
              geometry?: { location?: { lat: () => number; lng: () => number } };
            };
          };
        };
      };
    };
  }
}

let googleScriptPromise: Promise<void> | null = null;

function loadGoogleMapsScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();

  // Already loaded — resolve immediately
  if (window.google?.maps?.places) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;

  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
  if (!key) return Promise.resolve();

  googleScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-maps-js-api]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Maps script failed')));
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&v=weekly&loading=async`;
    script.async = true;
    script.dataset.mapsJsApi = 'true';
    script.addEventListener('load', () => {
      // The Maps API reports readiness by invoking the callback it is told to;
      // with `loading=async` the `load` event on the script element fires once
      // the bootstrap has executed, at which point window.google.maps exists.
      resolve();
    });
    script.addEventListener('error', () => {
      // Reset the cached promise so a later retry can re-attempt the load.
      googleScriptPromise = null;
      script.remove();
      reject(new Error('Maps script failed'));
    });
    document.head.appendChild(script);
  });

  return googleScriptPromise;
}

export function PlacesAutocomplete({
  value,
  onSelect,
  onTextChange,
  placeholder,
  ariaLabel,
  disabled,
  countryCode = 'NA',
}: PlacesAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<{ addListener: (e: string, cb: () => void) => void } | null>(null);
  const [mapsAvailable, setMapsAvailable] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  // Keep the latest callback in a ref so the Autocomplete widget is attached
  // exactly once, regardless of how often the parent re-renders. The ref is
  // updated in an effect (not during render) to satisfy react-hooks/refs.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    let cancelled = false;

    loadGoogleMapsScript()
      .then(() => {
        if (cancelled) return;
        if (!window.google?.maps?.places?.Autocomplete) {
          // Script loaded but Places is unavailable (e.g. key missing the
          // Places API). Only surface the retry path when a key exists —
          // with no key configured, retrying can never succeed.
          setMapsAvailable(false);
          if (process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY) setFailed(true);
          return;
        }
        setMapsAvailable(true);
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled) {
          setMapsAvailable(false);
          setFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  // Attach Autocomplete once the API is available — no onSelect dependency.
  useEffect(() => {
    if (!mapsAvailable || !inputRef.current) return;
    const Autocomplete = window.google?.maps?.places?.Autocomplete;
    if (!Autocomplete) return;

    const autocomplete = new Autocomplete(inputRef.current, {
      fields: ['place_id', 'formatted_address', 'name', 'geometry.location'],
      types: ['geocode', 'establishment'],
      componentRestrictions: { country: countryCode },
    });

    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      const name = place.formatted_address || place.name || inputRef.current?.value || '';
      if (!place.place_id) return;
      onSelectRef.current({
        name,
        placeId: place.place_id,
        lat: place.geometry?.location?.lat?.() ?? 0,
        lng: place.geometry?.location?.lng?.() ?? 0,
      });
    });

    autocompleteRef.current = autocomplete;
    return () => {
      // Detach the old widget's listeners if the effect re-runs (e.g. a
      // countryCode change) so listeners are never orphaned on the input.
      try {
        window.google?.maps?.event?.clearInstanceListeners?.(autocomplete);
      } catch {
        // ignore — the widget may already be detached
      }
      autocompleteRef.current = null;
    };
  }, [mapsAvailable, countryCode]);

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => onTextChange?.(e.target.value)}
        placeholder={placeholder || 'Search for a place…'}
        aria-label={ariaLabel}
        disabled={disabled}
        autoComplete="off"
      />
      {failed ? (
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            setLoadAttempt((n) => n + 1);
          }}
          className="text-brand-700 hover:text-brand-800 absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-medium underline underline-offset-2"
        >
          Retry
        </button>
      ) : (
        <MapPin className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-ink-400" />
      )}
    </div>
  );
}
