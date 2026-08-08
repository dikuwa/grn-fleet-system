/**
 * Announcement bar — optional banner above the header.
 *
 * Renders only when Platform Admin has enabled it, a message exists, and the
 * current date is within any configured start/end range. Not rendered at all
 * when disabled, so there is never an empty bar.
 */

import Link from 'next/link';
import { Megaphone } from 'lucide-react';
import type { PublicAnnouncementContent } from '@/lib/platform/site-settings-content';

function isWithinRange(
  announcement: PublicAnnouncementContent,
  today: Date,
): boolean {
  if (announcement.startDate) {
    const start = new Date(`${announcement.startDate}T00:00:00`);
    if (!Number.isNaN(start.getTime()) && today < start) return false;
  }
  if (announcement.endDate) {
    const end = new Date(`${announcement.endDate}T23:59:59`);
    if (!Number.isNaN(end.getTime()) && today > end) return false;
  }
  return true;
}

export function AnnouncementBar({
  announcement,
}: {
  announcement: PublicAnnouncementContent;
}) {
  if (!announcement.enabled) return null;
  if (!announcement.message.trim()) return null;
  if (!isWithinRange(announcement, new Date())) return null;

  const hasLink = Boolean(announcement.linkLabel.trim() && announcement.linkHref.trim());

  return (
    <div className="bg-brand-800 text-white">
      <div className="mx-auto flex h-10 max-w-[1200px] items-center justify-center gap-2 px-6 text-xs font-medium">
        <Megaphone className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden="true" />
        {announcement.label.trim() ? (
          <span className="shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
            {announcement.label}
          </span>
        ) : null}
        <span className="truncate">{announcement.message}</span>
        {hasLink ? (
          <>
            <span aria-hidden="true" className="opacity-40">·</span>
            <Link
              href={announcement.linkHref}
              className="shrink-0 underline underline-offset-2 transition-opacity hover:opacity-80"
            >
              {announcement.linkLabel}
            </Link>
          </>
        ) : null}
      </div>
    </div>
  );
}
