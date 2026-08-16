'use client';

import { useEffect, useState } from 'react';
import { CameraOff, ChevronLeft, ChevronRight, Images, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type InspectionPhoto = {
  id: string;
  signedUrl: string | null;
  caption: string | null;
  capturedAt: string;
};

function SafeInspectionImage({ photo, className }: { photo: InspectionPhoto; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!photo.signedUrl || failed) {
    return (
      <div className={`bg-muted text-ink-500 flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center ${className || ''}`}>
        <CameraOff className="h-7 w-7" aria-hidden="true" />
        <span className="text-xs">{photo.signedUrl ? 'Image unavailable' : 'No inspection photo'}</span>
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- authenticated, expiring R2 URL
  return <img src={photo.signedUrl} alt={photo.caption || 'Inspection evidence photo'} onError={() => setFailed(true)} className={className} />;
}

export function InspectionPhotoGallery({ photos }: { photos: InspectionPhoto[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const visible = photos.slice(0, 4);
  const activePhoto = activeIndex == null ? null : photos[activeIndex];
  const move = (direction: -1 | 1) => setActiveIndex((current) => current == null
    ? null
    : (current + direction + photos.length) % photos.length);

  useEffect(() => {
    if (activeIndex == null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') setActiveIndex((current) => current == null ? null : (current - 1 + photos.length) % photos.length);
      if (event.key === 'ArrowRight') setActiveIndex((current) => current == null ? null : (current + 1) % photos.length);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeIndex, photos.length]);

  if (photos.length === 0) {
    return (
      <div className="border-border bg-muted/30 text-ink-500 flex min-h-32 flex-col items-center justify-center gap-2 rounded-[8px] border border-dashed p-5 text-center">
        <CameraOff className="h-7 w-7" aria-hidden="true" />
        <p className="text-sm font-medium">No inspection photo</p>
        <p className="text-xs">No evidence image was uploaded with this inspection.</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {visible.map((photo, index) => (
          <button
            key={photo.id}
            type="button"
            onClick={() => photo.signedUrl && setActiveIndex(index)}
            disabled={!photo.signedUrl}
            aria-label={photo.signedUrl ? `Open inspection photo ${index + 1} of ${photos.length}` : `Inspection photo ${index + 1} unavailable`}
            className="focus-ring border-border bg-muted group relative aspect-[4/3] min-w-0 overflow-hidden rounded-[8px] border disabled:cursor-default"
          >
            <SafeInspectionImage photo={photo} className="h-full w-full object-cover transition-transform group-enabled:group-hover:scale-105 motion-reduce:transition-none" />
            {index === 3 && photos.length > 4 && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-lg font-semibold text-white">
                +{photos.length - 3}
              </span>
            )}
          </button>
        ))}
      </div>

      <Dialog open={activeIndex != null} onOpenChange={(open) => !open && setActiveIndex(null)}>
        <DialogContent className="h-[92dvh] w-[96vw] max-w-[1500px] overflow-hidden p-0">
          <DialogTitle className="sr-only">Inspection photo viewer</DialogTitle>
          {activePhoto && (
            <div className="bg-canvas flex h-full min-h-0 flex-col">
              <div className="border-border bg-surface flex items-center justify-between gap-3 border-b px-3 py-2 sm:px-4">
                <div className="min-w-0">
                  <p className="text-ink-950 truncate text-sm font-medium">{activePhoto.caption || 'Inspection evidence'}</p>
                  <p className="text-ink-500 text-xs tabular-nums">{activeIndex! + 1} of {photos.length} · {new Date(activePhoto.capturedAt).toLocaleString('en-NA')}</p>
                </div>
                <Button variant="secondary" size="icon-sm" onClick={() => setActiveIndex(null)} aria-label="Close photo viewer"><X className="h-4 w-4" /></Button>
              </div>
              <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2 sm:p-5">
                <SafeInspectionImage photo={activePhoto} className="max-h-full max-w-full object-contain" />
                {photos.length > 1 && (
                  <>
                    <Button variant="secondary" size="icon" className="absolute left-3 top-1/2 -translate-y-1/2 shadow-lg" onClick={() => move(-1)} aria-label="Previous photo"><ChevronLeft className="h-5 w-5" /></Button>
                    <Button variant="secondary" size="icon" className="absolute right-3 top-1/2 -translate-y-1/2 shadow-lg" onClick={() => move(1)} aria-label="Next photo"><ChevronRight className="h-5 w-5" /></Button>
                  </>
                )}
              </div>
              <div className="border-border bg-surface flex items-center gap-2 overflow-x-auto border-t p-2" aria-label="Inspection photo thumbnails">
                <Images className="text-ink-400 mx-1 h-4 w-4 shrink-0" />
                {photos.map((photo, index) => (
                  <button key={photo.id} type="button" onClick={() => setActiveIndex(index)} aria-label={`View photo ${index + 1}`} className={`focus-ring h-14 w-20 shrink-0 overflow-hidden rounded-[6px] border-2 ${index === activeIndex ? 'border-brand-700' : 'border-transparent'}`}>
                    <SafeInspectionImage photo={photo} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
