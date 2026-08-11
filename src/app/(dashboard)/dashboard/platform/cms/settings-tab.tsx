'use client';

import { useCallback, useRef, useState } from 'react';
import { ImageIcon, Info, Loader2, Save, Trash2, Upload } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, Label, Textarea } from '@/components/ui/input';
import { StyledDateInput } from '@/components/ui/styled-select';
import { useToast } from '@/lib/use-toast';

interface PublicContent {
  announcement: {
    enabled: boolean;
    label: string;
    message: string;
    linkLabel: string;
    linkHref: string;
    startDate: string | null;
    endDate: string | null;
  };
  hero: {
    eyebrow?: string;
    title: string;
    description: string;
    proofPoints: string[];
    primaryCtaLabel: string;
    primaryCtaHref: string;
    secondaryCtaLabel: string;
    secondaryCtaHref: string;
  };
  demo: {
    pageTitle: string;
    description: string;
    formIntro: string;
    successMessage: string;
    expectedResponse: string;
  };
  contact: {
    salesEmail: string;
    supportEmail: string;
    phone: string;
    secondaryPhone: string;
    address: string;
    city: string;
    country: string;
    mapUrl: string;
    hours: string;
    intro: string;
  };
  footer: {
    description: string;
    copyrightText: string;
  };
  seo: {
    homepageTitle: string;
    homepageDescription: string;
    aboutTitle: string;
    aboutDescription: string;
    servicesTitle: string;
    servicesDescription: string;
    contactTitle: string;
    contactDescription: string;
    demoTitle: string;
    demoDescription: string;
    faqTitle: string;
    faqDescription: string;
    socialImageUrl: string;
  };
}

interface BrandFields {
  siteName: string;
  siteTagline: string;
  logoUrl: string;
  faviconUrl: string;
}

interface SettingsTabProps {
  content: PublicContent;
  brand: BrandFields;
  lastUpdatedAt: string | null;
  onSaved: (updatedAt: string) => void;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-ink-800">{label}</Label>
      {children}
      {hint ? <p className="text-xs leading-relaxed text-ink-400">{hint}</p> : null}
    </div>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <CardHeader>
      <CardTitle className="text-base">{title}</CardTitle>
      <p className="text-xs leading-relaxed text-ink-500">{description}</p>
    </CardHeader>
  );
}

export function SiteSettingsTab({ content: initialContent, brand: initialBrand, lastUpdatedAt, onSaved }: SettingsTabProps) {
  const { toast } = useToast();
  const [content, setContent] = useState<PublicContent>(initialContent);
  const [brand, setBrand] = useState<BrandFields>(initialBrand);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<'logo' | 'favicon' | null>(null);
  const [mediaKeys, setMediaKeys] = useState<Partial<Record<'logo' | 'favicon', string>>>({});
  const logoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);
  const [savedAt, setSavedAt] = useState<string | null>(lastUpdatedAt);

  const setHero = useCallback((key: keyof PublicContent['hero'], value: unknown) => {
    setContent((current) => ({ ...current, hero: { ...current.hero, [key]: value } }));
  }, []);
  const setAnnouncement = useCallback((key: keyof PublicContent['announcement'], value: unknown) => {
    setContent((current) => ({ ...current, announcement: { ...current.announcement, [key]: value } }));
  }, []);
  const setContact = useCallback((key: keyof PublicContent['contact'], value: string) => {
    setContent((current) => ({ ...current, contact: { ...current.contact, [key]: value } }));
  }, []);
  const setDemo = useCallback((key: keyof PublicContent['demo'], value: string) => {
    setContent((current) => ({ ...current, demo: { ...current.demo, [key]: value } }));
  }, []);
  const setFooter = useCallback((key: keyof PublicContent['footer'], value: string) => {
    setContent((current) => ({ ...current, footer: { ...current.footer, [key]: value } }));
  }, []);
  const setSeo = useCallback((key: keyof PublicContent['seo'], value: string) => {
    setContent((current) => ({ ...current, seo: { ...current.seo, [key]: value } }));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      // Preserve the legacy eyebrow property in storage if it exists, but the
      // public design no longer exposes or renders an eyebrow control.
      const payloadContent = {
        ...content,
        hero: { ...content.hero, eyebrow: initialContent.hero.eyebrow ?? '' },
      };
      const res = await fetch('/api/platform/cms/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, publicContent: payloadContent }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save settings');
      const updatedAt = json.data?.settings?.updatedAt ?? new Date().toISOString();
      setSavedAt(updatedAt);
      onSaved(updatedAt);
      toast({ title: 'Public site updated', description: 'Content changes are live on the public site.', variant: 'success' });
    } catch (error) {
      toast({ title: 'Could not save site settings', description: error instanceof Error ? error.message : 'Save failed', variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const uploadBrandImage = async (kind: 'logo' | 'favicon', file?: File) => {
    if (!file) return;
    setUploading(kind);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('kind', kind);
      const res = await fetch('/api/platform/cms/media', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Upload failed');
      setBrand((current) => ({ ...current, [kind === 'logo' ? 'logoUrl' : 'faviconUrl']: json.data.url }));
      setMediaKeys((current) => ({ ...current, [kind]: json.data.key }));
      toast({ title: `${kind === 'logo' ? 'Logo' : 'Favicon'} uploaded`, description: 'Preview updated. Save changes to publish it.', variant: 'success' });
    } catch (error) {
      toast({ title: 'Upload failed', description: error instanceof Error ? error.message : 'Image upload failed', variant: 'error' });
    } finally {
      setUploading(null);
    }
  };

  const clearBrandImage = async (kind: 'logo' | 'favicon') => {
    const key = mediaKeys[kind];
    if (key) await fetch('/api/platform/cms/media', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) }).catch(() => undefined);
    setBrand((current) => ({ ...current, [kind === 'logo' ? 'logoUrl' : 'faviconUrl']: '' }));
    setMediaKeys((current) => ({ ...current, [kind]: undefined }));
  };

  const savedLabel = savedAt
    ? `Last updated ${new Date(savedAt).toLocaleString('en-NA', { dateStyle: 'medium', timeStyle: 'short' })}`
    : 'Not saved yet';

  const seoPairs: Array<[keyof PublicContent['seo'], keyof PublicContent['seo'], string]> = [
    ['homepageTitle', 'homepageDescription', 'Homepage'],
    ['aboutTitle', 'aboutDescription', 'About'],
    ['servicesTitle', 'servicesDescription', 'Platform / Services'],
    ['contactTitle', 'contactDescription', 'Contact'],
    ['demoTitle', 'demoDescription', 'Request Demo'],
    ['faqTitle', 'faqDescription', 'FAQs'],
  ];

  return (
    <div className="space-y-6">
      <div className="sticky top-[calc(4rem+env(safe-area-inset-top,0px))] z-20 flex flex-col gap-3 rounded-[10px] border border-border bg-surface/95 p-4 shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
          <div><p className="text-sm font-medium text-ink-800">Public website content</p><p className="mt-0.5 text-xs text-ink-500">Content is editable here; layout, workflow and permissions remain controlled by code. · {savedLabel}</p></div>
        </div>
        <Button size="sm" onClick={() => void save()} loading={saving}><Save className="h-4 w-4" /> Save changes</Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeader title="Brand" description="Public platform name, logo references and browser icon." />
          <CardContent className="space-y-4">
            <Field label="Public platform name"><Input value={brand.siteName} maxLength={120} onChange={(event) => setBrand((current) => ({ ...current, siteName: event.target.value }))} /></Field>
            <Field label="Tagline"><Input value={brand.siteTagline} maxLength={200} onChange={(event) => setBrand((current) => ({ ...current, siteTagline: event.target.value }))} /></Field>
            {(['logo', 'favicon'] as const).map((kind) => {
              const value = kind === 'logo' ? brand.logoUrl : brand.faviconUrl;
              const inputRef = kind === 'logo' ? logoInputRef : faviconInputRef;
              return <Field key={kind} label={kind === 'logo' ? 'Logo' : 'Favicon'} hint="Upload an image or paste a public HTTPS URL.">
                <div className="space-y-2">
                  {value ? <div className="flex min-h-20 items-center justify-center rounded-[8px] border border-border bg-muted/30 p-3"><img src={value} alt={`${kind} preview`} className={kind === 'favicon' ? 'h-12 w-12 object-contain' : 'max-h-20 max-w-full object-contain'} /></div> : <div className="flex min-h-20 items-center justify-center rounded-[8px] border border-dashed border-border text-ink-400"><ImageIcon className="h-5 w-5" /><span className="ml-2 text-xs">No {kind} selected</span></div>}
                  <Input type="url" value={value} onChange={(event) => setBrand((current) => ({ ...current, [kind === 'logo' ? 'logoUrl' : 'faviconUrl']: event.target.value }))} placeholder="https://…" />
                  <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => void uploadBrandImage(kind, event.target.files?.[0])} />
                  <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" size="sm" loading={uploading === kind} onClick={() => inputRef.current?.click()}><Upload className="h-4 w-4" /> Upload</Button>{value && <Button type="button" variant="ghost" size="sm" className="text-status-error-text" onClick={() => void clearBrandImage(kind)}><Trash2 className="h-4 w-4" /> Remove</Button>}</div>
                </div>
              </Field>;
            })}
          </CardContent>
        </Card>

        <Card>
          <SectionHeader title="Homepage hero" description="Headline, supporting copy, proof points and the two existing calls to action." />
          <CardContent className="space-y-4">
            <Field label="Hero title"><Input value={content.hero.title} maxLength={200} onChange={(event) => setHero('title', event.target.value)} /></Field>
            <Field label="Hero description"><Textarea rows={3} value={content.hero.description} maxLength={600} onChange={(event) => setHero('description', event.target.value)} /></Field>
            <Field label="Value statements" hint="One statement per line."><Textarea rows={5} value={content.hero.proofPoints.join('\n')} onChange={(event) => setHero('proofPoints', event.target.value.split('\n').map((value) => value.trim()).filter(Boolean))} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Primary CTA label"><Input value={content.hero.primaryCtaLabel} onChange={(event) => setHero('primaryCtaLabel', event.target.value)} /></Field>
              <Field label="Primary CTA link"><Input value={content.hero.primaryCtaHref} onChange={(event) => setHero('primaryCtaHref', event.target.value)} /></Field>
              <Field label="Secondary CTA label"><Input value={content.hero.secondaryCtaLabel} onChange={(event) => setHero('secondaryCtaLabel', event.target.value)} /></Field>
              <Field label="Secondary CTA link"><Input value={content.hero.secondaryCtaHref} onChange={(event) => setHero('secondaryCtaHref', event.target.value)} /></Field>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <SectionHeader title="Announcement bar" description="Optional public banner and its active date window." />
          <CardContent className="space-y-4">
            <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-medium text-ink-800">
              <Checkbox checked={content.announcement.enabled} onCheckedChange={(checked) => setAnnouncement('enabled', checked === true)} /> Show announcement bar
            </label>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Label"><Input value={content.announcement.label} maxLength={60} onChange={(event) => setAnnouncement('label', event.target.value)} /></Field>
              <Field label="Message"><Input value={content.announcement.message} maxLength={200} onChange={(event) => setAnnouncement('message', event.target.value)} /></Field>
              <Field label="Link label"><Input value={content.announcement.linkLabel} onChange={(event) => setAnnouncement('linkLabel', event.target.value)} /></Field>
              <Field label="Link href"><Input value={content.announcement.linkHref} onChange={(event) => setAnnouncement('linkHref', event.target.value)} /></Field>
              <Field label="Start date"><StyledDateInput type="date" value={content.announcement.startDate ?? ''} onChange={(event) => setAnnouncement('startDate', event.target.value || null)} /></Field>
              <Field label="End date"><StyledDateInput type="date" value={content.announcement.endDate ?? ''} onChange={(event) => setAnnouncement('endDate', event.target.value || null)} /></Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <SectionHeader title="Contact page" description="Public contact details and introductory copy." />
          <CardContent className="space-y-4">
            <Field label="Intro"><Textarea rows={3} value={content.contact.intro} onChange={(event) => setContact('intro', event.target.value)} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Sales / demo email"><Input type="email" value={content.contact.salesEmail} onChange={(event) => setContact('salesEmail', event.target.value)} /></Field>
              <Field label="Support email"><Input type="email" value={content.contact.supportEmail} onChange={(event) => setContact('supportEmail', event.target.value)} /></Field>
              <Field label="Phone"><Input type="tel" value={content.contact.phone} onChange={(event) => setContact('phone', event.target.value)} /></Field>
              <Field label="Secondary phone"><Input type="tel" value={content.contact.secondaryPhone} onChange={(event) => setContact('secondaryPhone', event.target.value)} /></Field>
              <Field label="Address"><Input value={content.contact.address} onChange={(event) => setContact('address', event.target.value)} /></Field>
              <Field label="City"><Input value={content.contact.city} onChange={(event) => setContact('city', event.target.value)} /></Field>
              <Field label="Country"><Input value={content.contact.country} onChange={(event) => setContact('country', event.target.value)} /></Field>
              <Field label="Business hours"><Input value={content.contact.hours} onChange={(event) => setContact('hours', event.target.value)} /></Field>
            </div>
            <Field label="Map URL"><Input type="url" value={content.contact.mapUrl} onChange={(event) => setContact('mapUrl', event.target.value)} /></Field>
          </CardContent>
        </Card>

        <Card>
          <SectionHeader title="Request Demo" description="Public demo page copy and confirmation messaging." />
          <CardContent className="space-y-4">
            <Field label="Page title"><Input value={content.demo.pageTitle} onChange={(event) => setDemo('pageTitle', event.target.value)} /></Field>
            <Field label="Description"><Textarea rows={3} value={content.demo.description} onChange={(event) => setDemo('description', event.target.value)} /></Field>
            <Field label="Form introduction"><Textarea rows={3} value={content.demo.formIntro} onChange={(event) => setDemo('formIntro', event.target.value)} /></Field>
            <Field label="Success message"><Textarea rows={3} value={content.demo.successMessage} onChange={(event) => setDemo('successMessage', event.target.value)} /></Field>
            <Field label="Expected response"><Input value={content.demo.expectedResponse} onChange={(event) => setDemo('expectedResponse', event.target.value)} /></Field>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <SectionHeader title="Footer" description="Public footer copy. Navigation structure remains controlled by code." />
          <CardContent className="grid gap-4 lg:grid-cols-2">
            <Field label="Description"><Textarea rows={3} value={content.footer.description} onChange={(event) => setFooter('description', event.target.value)} /></Field>
            <Field label="Copyright text"><Textarea rows={3} value={content.footer.copyrightText} onChange={(event) => setFooter('copyrightText', event.target.value)} /></Field>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <SectionHeader title="Search & sharing metadata" description="Page titles/descriptions and the public social-share image." />
          <CardContent className="space-y-5">
            <div className="grid gap-5 lg:grid-cols-2">
              {seoPairs.map(([titleKey, descriptionKey, label]) => (
                <div key={label} className="space-y-3 rounded-[8px] border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
                  <Field label="Title"><Input value={content.seo[titleKey]} onChange={(event) => setSeo(titleKey, event.target.value)} /></Field>
                  <Field label="Description"><Textarea rows={3} value={content.seo[descriptionKey]} onChange={(event) => setSeo(descriptionKey, event.target.value)} /></Field>
                </div>
              ))}
            </div>
            <div className="max-w-xl"><Field label="Social share image URL"><Input type="url" value={content.seo.socialImageUrl} onChange={(event) => setSeo('socialImageUrl', event.target.value)} /></Field></div>
          </CardContent>
        </Card>
      </div>

      {saving && <span className="sr-only" role="status"><Loader2 className="h-4 w-4" /> Saving settings</span>}
    </div>
  );
}
