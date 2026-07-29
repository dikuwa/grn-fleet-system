'use client';

import { useEffect, useRef, useState } from 'react';
import { Eraser, Loader2, PenLine, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { useToast } from '@/lib/use-toast';

type SignatureData = {
  type: 'typed' | 'uploaded' | 'drawn' | null;
  typedName: string | null;
  confirmedAt: string | null;
  previewUrl: string | null;
};

export function SignatureProfile({ defaultName }: { defaultName: string }) {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [mode, setMode] = useState<'typed' | 'uploaded' | 'drawn'>('typed');
  const [typedName, setTypedName] = useState(defaultName);
  const [data, setData] = useState<SignatureData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const response = await fetch('/api/users/signature', { cache: 'no-store' });
    const result = await response.json();
    if (response.ok) {
      setData(result.data);
      if (result.data.typedName) setTypedName(result.data.typedName);
    }
    setLoading(false);
  };
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const upload = async (file: File, type: 'uploaded' | 'drawn') => {
    setSaving(true);
    const form = new FormData();
    form.set('file', file);
    form.set('type', type);
    const response = await fetch('/api/users/signature', { method: 'POST', body: form });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) {
      toast({ title: 'Signature not saved', description: result.error, variant: 'error' });
      return;
    }
    await load();
    toast({ title: 'Signature confirmed', variant: 'success' });
  };

  const saveTyped = async () => {
    setSaving(true);
    const response = await fetch('/api/users/signature', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ typedName }),
    });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) {
      toast({ title: 'Signature not saved', description: result.error, variant: 'error' });
      return;
    }
    await load();
    toast({ title: 'Signature confirmed', variant: 'success' });
  };

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
    };
  };
  const begin = (event: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    const context = canvasRef.current!.getContext('2d')!;
    const current = point(event);
    context.beginPath();
    context.moveTo(current.x, current.y);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const draw = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const context = canvasRef.current!.getContext('2d')!;
    const current = point(event);
    context.strokeStyle = '#111827';
    context.lineWidth = 2.5;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineTo(current.x, current.y);
    context.stroke();
  };
  const clear = () => {
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  };
  const saveDrawing = () =>
    canvasRef.current?.toBlob((blob) => {
      if (blob)
        void upload(new File([blob], 'drawn-signature.png', { type: 'image/png' }), 'drawn');
    }, 'image/png');

  const remove = async () => {
    setSaving(true);
    await fetch('/api/users/signature', { method: 'DELETE' });
    setSaving(false);
    setData(null);
    toast({ title: 'Signature removed', variant: 'success' });
  };

  if (loading) {
    return (
      <div className="flex h-28 items-center justify-center">
        <Loader2 className="text-ink-400 h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {data?.type && (
        <div className="border-status-success-bg bg-status-success-bg flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-ink-950 text-sm font-medium">Confirmed {data.type} signature</p>
            <p className="text-ink-500 text-xs">
              Applied only when you complete an authorised workflow action.
            </p>
          </div>
          {data.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.previewUrl}
              alt="Your saved signature"
              className="h-12 max-w-32 object-contain"
            />
          ) : (
            <span className="font-signature text-ink-950 text-3xl">{data.typedName}</span>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Signature method">
        {(['typed', 'uploaded', 'drawn'] as const).map((method) => (
          <Button
            key={method}
            type="button"
            variant={mode === method ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setMode(method)}
          >
            {method === 'typed' ? <PenLine className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
            {method === 'typed' ? 'Type' : method === 'uploaded' ? 'Upload PNG' : 'Draw'}
          </Button>
        ))}
      </div>
      {mode === 'typed' && (
        <div className="space-y-2">
          <Label>Signature name</Label>
          <Input value={typedName} onChange={(event) => setTypedName(event.target.value)} />
          <div className="font-signature border-border rounded-lg border bg-white p-4 text-4xl text-slate-900">
            {typedName || 'Signature preview'}
          </div>
          <Button onClick={saveTyped} loading={saving}>
            Confirm typed signature
          </Button>
        </div>
      )}
      {mode === 'uploaded' && (
        <label className="border-border flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed p-4 text-center">
          <Upload className="text-ink-400 mb-2 h-5 w-5" />
          <span className="text-ink-950 text-sm font-medium">Choose transparent PNG</span>
          <span className="text-ink-500 text-xs">Maximum 1 MB. Stored privately.</span>
          <input
            type="file"
            accept="image/png"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file, 'uploaded');
            }}
          />
        </label>
      )}
      {mode === 'drawn' && (
        <div className="space-y-2">
          <canvas
            ref={canvasRef}
            width={700}
            height={180}
            onPointerDown={begin}
            onPointerMove={draw}
            onPointerUp={() => (drawing.current = false)}
            onPointerCancel={() => (drawing.current = false)}
            className="border-border h-36 w-full touch-none rounded-lg border bg-white"
            aria-label="Draw your signature"
          />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={clear}>
              <Eraser className="h-4 w-4" /> Clear
            </Button>
            <Button onClick={saveDrawing} loading={saving}>
              Confirm drawn signature
            </Button>
          </div>
        </div>
      )}
      {data?.type && (
        <Button
          variant="secondary"
          onClick={remove}
          disabled={saving}
          className="text-status-error-text"
        >
          <Trash2 className="h-4 w-4" /> Remove saved signature
        </Button>
      )}
    </div>
  );
}
