'use client';

import { useEffect, useState, useRef } from 'react';
import QRCode from 'qrcode';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

interface Props {
  shareUrl: string | null | undefined;
  documentTitle: string;
}

export function QRDisplay({ shareUrl, documentTitle }: Props) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!shareUrl) return;

    QRCode.toDataURL(shareUrl, {
      width: 240,
      margin: 1,
      color: { dark: '#1F4E8C', light: '#FFFFFF' },
    })
      .then(setQrDataUrl)
      .catch(() => {
        // Fallback: try drawing to canvas
        if (canvasRef.current) {
          QRCode.toCanvas(canvasRef.current, shareUrl, {
            width: 240,
            margin: 1,
            color: { dark: '#1F4E8C', light: '#FFFFFF' },
          }).catch(() => setError('Could not generate QR code'));
        }
      });
  }, [shareUrl]);

  const handleDownload = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.download = `${documentTitle.replace(/[^a-zA-Z0-9]/g, '_')}_qr.png`;
    link.href = qrDataUrl;
    link.click();
  };

  if (!shareUrl) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>QR Code</CardTitle>
        {qrDataUrl && (
          <Button variant="secondary" size="sm" onClick={handleDownload}>
            <Download className="h-4 w-4" /> Download
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col items-center py-6">
        {error ? (
          <p className="text-xs text-status-error-text">{error}</p>
        ) : qrDataUrl ? (
          <div className="space-y-3 flex flex-col items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt="Verification QR Code"
              className="rounded-[8px] border border-border"
              width={240}
              height={240}
            />
            <p className="text-[10px] text-ink-400 text-center max-w-[240px] leading-relaxed">
              Scan to verify document authenticity
            </p>
          </div>
        ) : (
          <div className="h-[240px] w-[240px] animate-pulse rounded-[8px] bg-muted" />
        )}
        {/* Hidden canvas fallback */}
        <canvas ref={canvasRef} className="hidden" />
      </CardContent>
    </Card>
  );
}
