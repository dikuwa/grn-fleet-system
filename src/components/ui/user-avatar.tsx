'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

interface UserAvatarProps {
  src?: string | null;
  name: string;
  className?: string;
  imageClassName?: string;
}

export function UserAvatar({ src, name, className, imageClassName }: UserAvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const showImage = Boolean(src && src !== failedSrc);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'U';

  return (
    <span
      className={cn(
        'flex items-center justify-center overflow-hidden bg-brand-50 font-semibold text-brand-700',
        className,
      )}
      aria-label={name}
    >
      {showImage ? (
        <img
          src={src!}
          alt=""
          className={cn('h-full w-full object-cover', imageClassName)}
          onError={() => setFailedSrc(src!)}
          referrerPolicy="no-referrer"
        />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </span>
  );
}
