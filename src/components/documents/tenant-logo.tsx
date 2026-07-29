'use client';

import { useState } from 'react';

export function TenantLogo({
  src,
  organisationName,
  code,
  className = 'h-12 w-12',
}: {
  src?: string | null;
  organisationName: string;
  code?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span
        className={`${className} border-border bg-surface text-brand-800 flex items-center justify-center rounded-md border text-xs font-bold`}
        aria-label={`${organisationName} logo fallback`}
      >
        {(code || organisationName)
          .split(/\s+/)
          .map((word) => word[0])
          .join('')
          .slice(0, 3)
          .toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`${organisationName} logo`}
      className={`${className} object-contain`}
      onError={() => setFailed(true)}
    />
  );
}
