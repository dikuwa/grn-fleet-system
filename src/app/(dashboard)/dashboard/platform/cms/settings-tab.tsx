'use client';

/**
 * Site Settings tab — Platform Admin editing of the public website content.
 *
 * Content is grouped into cards: Brand, Homepage hero, Announcement, Contact,
 * Request Demo, Footer and SEO. One Save button persists everything through
 * /api/platform/cms/settings, which sanitises every field server-side.
 * CMS controls content only — structure and design stay in code.
 */

import { useState, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Loader2, Save, Info } from 'lucide-react';
import { useToast } from '@/lib/use-toast';

// ---------------------------------------------------------------------------
// Types (mirror the server-side shape)
// ---------------------------------------------------------------------------

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
    eyebrow: string;
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

// ---------------------------------------------------------------------------
// Field primitives
// ---------------------------------------------------------------------------

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-ink-800">{label}</Label>
      {children}
      {hint ? <p className="text-xs text-ink-400">{hint}</p> : null}
    </div>
  );
}

function inputClass() {
  return 'w-full h-10 px-3 text-sm border border-border rounded-[8px] bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500';
}

function textareaClass() {
  return 'w-full px-3 py-2 text-sm border border-border rounded-[8px] bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SiteSettingsTab({
  content: initialContent,
  brand: initialBrand,
  lastUpdatedAt,
  onSaved,
}: SettingsTabProps) {
  const { toast } = useToast();

  const [content, setContent] = useState<PublicContent>(initialContent);
  const [brand, setBrand] = useState<BrandFields>(initialBrand);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(lastUpdatedAt);

  // Props are always fresh on mount — the tab is unmounted whenever the user
  // leaves it, so there is no need to re-sync from parent props.

  const setHero = useCallback((key: keyof PublicContent['hero'], value: unknown) => {
    setContent((prev) => ({ ...prev, hero: { ...prev.hero, [key]: value } }));
  }, []);

  const setAnnouncement = useCallback(
    (key: keyof PublicContent['announcement'], value: unknown) => {
      setContent((prev) => ({
        ...prev,
        announcement: { ...prev.announcement, [key]: value },
      }));
    },
    [],
  );

  const setContact = useCallback(
    (key: keyof PublicContent['contact'], value: string) => {
      setContent((prev) => ({ ...prev, contact: { ...prev.contact, [key]: value } }));
    },
    [],
  );

  const setDemo = useCallback((key: keyof PublicContent['demo'], value: string) => {
    setContent((prev) => ({ ...prev, demo: { ...prev.demo, [key]: value } }));
  }, []);

  const setFooter = useCallback(
    (key: keyof PublicContent['footer'], value: string) => {
      setContent((prev) => ({ ...prev, footer: { ...prev.footer, [key]: value } }));
    },
    [],
  );

  const setSeo = useCallback((key: keyof PublicContent['seo'], value: string) => {
    setContent((prev) => ({ ...prev, seo: { ...prev.seo, [key]: value } }));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/platform/cms/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, publicContent: content }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save settings');
      const updatedAt = json.data?.settings?.updatedAt ?? new Date().toISOString();
      setSavedAt(updatedAt);
      onSaved(updatedAt);
      toast({
        title: 'Saved',
        description: 'Public site content updated. Changes are live on the public site.',
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save settings',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const formatSaved = (iso: string | null) => {
    if (!iso) return 'Not saved yet';
    return `Last updated ${new Date(iso).toLocaleString('en-NA', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })}`;
  };

  const cardHeader = (title: string, description: string) => (
    <CardHeader>
      <CardTitle className="text-base">{title}</CardTitle>
      <p className="text-xs text-ink-500">{description}</p>
    </CardHeader>
  );

  return (
    <div className="space-y-6">
      {/* Save bar */}
      <div className="flex items-center justify-between rounded-[12px] border border-border bg-surface p-4">
        <div className="flex items-center gap-3 text-sm text-ink-500">
          <Info className="h-4 w-4 text-brand-500" />
          <span>
            Changes are saved directly to the live public site. Content only —
            layout and design are controlled by code.
          </span>
          <span className="hidden text-xs text-ink-400 md:inline">· {formatSaved(savedAt)}</span>
        </div>
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
              Saving…
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-1" />
              Save Changes
            </>
          )}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Brand */}
        <Card className="lg:col-span-1">
          {cardHeader('Brand', 'Public platform name, wordmark and favicon')}
          <CardContent className="space-y-4">
            <Field label="Public platform name">
              <Input
                className={inputClass()}
                value={brand.siteName}
                maxLength={120}
                onChange={(e) => setBrand((prev) => ({ ...prev, siteName: e.target.value }))}
              />
            </Field>
            <Field label="Tagline">
              <Input
                className={inputClass()}
                value={brand.siteTagline}
                maxLength={200}
                onChange={(e) => setBrand((prev) => ({ ...prev, siteTagline: e.target.value }))}
              />
            </Field>
            <Field label="Logo URL" hint="https:// image URL for the public wordmark">
              <Input
                className={inputClass()}
                value={brand.logoUrl}
                onChange={(e) => setBrand((prev) => ({ ...prev, logoUrl: e.target.value }))}
              />
            </Field>
            <Field label="Favicon URL">
              <Input
                className={inputClass()}
                value={brand.faviconUrl}
                onChange={(e) => setBrand((prev) => ({ ...prev, faviconUrl: e.target.value }))}
              />
            </Field>
          </CardContent>
        </Card>

        {/* Homepage hero */}
        <Card className="lg:col-span-1">
          {cardHeader('Homepage hero', 'Headline, description and CTAs on the homepage')}
          <CardContent className="space-y-4">
            <Field label="Eyebrow / contextual label">
              <Input
                className={inputClass()}
                value={content.hero.eyebrow}
                maxLength={120}
                onChange={(e) => setHero('eyebrow', e.target.value)}
              />
            </Field>
            <Field label="Hero title">
              <Input
                className={inputClass()}
                value={content.hero.title}
                maxLength={200}
                onChange={(e) => setHero('title', e.target.value)}
              />
            </Field>
            <Field label="Hero description">
              <Textarea
                className={textareaClass()}
                rows={3}
                value={content.hero.description}
                maxLength={600}
                onChange={(e) => setHero('description', e.target.value)}
              />
            </Field>
            <Field label="Value statements" hint="One per line — shown under the hero">
              <Textarea
                className={textareaClass()}
                rows={4}
                value={content.hero.proofPoints.join('\n')}
                onChange={(e) =>
                  setHero(
                    'proofPoints',
                    e.target.value.split('\n').map((p) => p.trim()).filter(Boolean),
                  )
                }
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Primary CTA label">
                <Input
                  className={inputClass()}
                  value={content.hero.primaryCtaLabel}
                  maxLength={60}
                  onChange={(e) => setHero('primaryCtaLabel', e.target.value)}
                />
              </Field>
              <Field label="Primary CTA link" hint="e.g. /request-demo or https://…">
                <Input
                  className={inputClass()}
                  value={content.hero.primaryCtaHref}
                  onChange={(e) => setHero('primaryCtaHref', e.target.value)}
                />
              </Field>
              <Field label="Secondary CTA label">
                <Input
                  className={inputClass()}
                  value={content.hero.secondaryCtaLabel}
                  maxLength={60}
                  onChange={(e) => setHero('secondaryCtaLabel', e.target.value)}
                />
              </Field>
              <Field label="Secondary CTA link">
                <Input
                  className={inputClass()}
                  value={content.hero.secondaryCtaHref}
                  onChange={(e) => setHero('secondaryCtaHref', e.target.value)}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* Announcement */}
        <Card className="lg:col-span-2">
          {cardHeader('Announcement bar', 'Optional banner above the header (e.g. “Pilot applications now open”)')}
          <CardContent>
            <div className="mb-4 flex items-center gap-2">
              <input
                id="announcement-enabled"
                type="checkbox"
                checked={content.announcement.enabled}
                onChange={(e) => setAnnouncement('enabled', e.target.checked)}
                className="h-4 w-4 rounded border-border text-brand-600 focus:ring-brand-500"
              />
              <Label htmlFor="announcement-enabled" className="text-sm font-medium text-ink-800">
                Show announcement bar
              </Label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Label" hint="Small prefix, e.g. “New”">
                <Input
                  className={inputClass()}
                  value={content.announcement.label}
                  maxLength={60}
                  onChange={(e) => setAnnouncement('label', e.target.value)}
                />
              </Field>
              <Field label="Message">
                <Input
                  className={inputClass()}
                  value={content.announcement.message}
                  maxLength={200}
                  onChange={(e) => setAnnouncement('message', e.target.value)}
                />
              </Field>
              <Field label="Link label" hint="Optional">
                <Input
                  className={inputClass()}
                  value={content.announcement.linkLabel}
                  maxLength={60}
                  onChange={(e) => setAnnouncement('linkLabel', e.target.value)}
                />
              </Field>
              <Field label="Link href" hint="Optional">
                <Input
                  className={inputClass()}
                  value={content.announcement.linkHref}
                  onChange={(e) => setAnnouncement('linkHref', e.target.value)}
                />
              </Field>
              <Field label="Start date" hint="Optional — ISO date">
                <Input
                  className={inputClass()}
                  type="date"
                  value={content.announcement.startDate ?? ''}
                  onChange={(e) => setAnnouncement('startDate', e.target.value || null)}
                />
              </Field>
              <Field label="End date" hint="Optional — ISO date">
                <Input
                  className={inputClass()}
                  type="date"
                  value={content.announcement.endDate ?? ''}
                  onChange={(e) => setAnnouncement('endDate', e.target.value || null)}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* Contact */}
        <Card className="lg:col-span-1">
          {cardHeader('Contact', 'Public contact details shown in the header, footer and contact page')}
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Sales / demo email">
                <Input
                  className={inputClass()}
                  type="email"
                  value={content.contact.salesEmail}
                  maxLength={160}
                  onChange={(e) => setContact('salesEmail', e.target.value)}
                />
              </Field>
              <Field label="Support email">
                <Input
                  className={inputClass()}
                  type="email"
                  value={content.contact.supportEmail}
                  maxLength={160}
                  onChange={(e) => setContact('supportEmail', e.target.value)}
                />
              </Field>
              <Field label="Phone">
                <Input
                  className={inputClass()}
                  value={content.contact.phone}
                  maxLength={60}
                  onChange={(e) => setContact('phone', e.target.value)}
                />
              </Field>
              <Field label="Secondary phone">
                <Input
                  className={inputClass()}
                  value={content.contact.secondaryPhone}
                  maxLength={60}
                  onChange={(e) => setContact('secondaryPhone', e.target.value)}
                />
              </Field>
            </div>
            <Field label="Address">
              <Input
                className={inputClass()}
                value={content.contact.address}
                maxLength={240}
                onChange={(e) => setContact('address', e.target.value)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="City">
                <Input
                  className={inputClass()}
                  value={content.contact.city}
                  maxLength={80}
                  onChange={(e) => setContact('city', e.target.value)}
                />
              </Field>
              <Field label="Country">
                <Input
                  className={inputClass()}
                  value={content.contact.country}
                  maxLength={80}
                  onChange={(e) => setContact('country', e.target.value)}
                />
              </Field>
              <Field label="Hours">
                <Input
                  className={inputClass()}
                  value={content.contact.hours}
                  maxLength={120}
                  onChange={(e) => setContact('hours', e.target.value)}
                />
              </Field>
            </div>
            <Field label="Map URL" hint="Optional — only shown if a real location is configured">
              <Input
                className={inputClass()}
                value={content.contact.mapUrl}
                onChange={(e) => setContact('mapUrl', e.target.value)}
              />
            </Field>
            <Field label="Contact page intro">
              <Textarea
                className={textareaClass()}
                rows={2}
                value={content.contact.intro}
                maxLength={600}
                onChange={(e) => setContact('intro', e.target.value)}
              />
            </Field>
          </CardContent>
        </Card>

        {/* Request demo */}
        <Card className="lg:col-span-1">
          {cardHeader('Request a Demo', 'Copy for the /request-demo page and success state')}
          <CardContent className="space-y-4">
            <Field label="Page title">
              <Input
                className={inputClass()}
                value={content.demo.pageTitle}
                maxLength={200}
                onChange={(e) => setDemo('pageTitle', e.target.value)}
              />
            </Field>
            <Field label="Page description">
              <Textarea
                className={textareaClass()}
                rows={2}
                value={content.demo.description}
                maxLength={600}
                onChange={(e) => setDemo('description', e.target.value)}
              />
            </Field>
            <Field label="Form intro">
              <Textarea
                className={textareaClass()}
                rows={2}
                value={content.demo.formIntro}
                maxLength={600}
                onChange={(e) => setDemo('formIntro', e.target.value)}
              />
            </Field>
            <Field label="Success message" hint="Shown after a demo request is submitted">
              <Textarea
                className={textareaClass()}
                rows={3}
                value={content.demo.successMessage}
                maxLength={600}
                onChange={(e) => setDemo('successMessage', e.target.value)}
              />
            </Field>
            <Field label="Expected response" hint="What the prospect should expect next">
              <Textarea
                className={textareaClass()}
                rows={2}
                value={content.demo.expectedResponse}
                maxLength={600}
                onChange={(e) => setDemo('expectedResponse', e.target.value)}
              />
            </Field>
          </CardContent>
        </Card>

        {/* Footer */}
        <Card className="lg:col-span-1">
          {cardHeader('Footer', 'Footer description and copyright text')}
          <CardContent className="space-y-4">
            <Field label="Footer description">
              <Textarea
                className={textareaClass()}
                rows={4}
                value={content.footer.description}
                maxLength={600}
                onChange={(e) => setFooter('description', e.target.value)}
              />
            </Field>
            <Field label="Copyright text" hint="Blank uses the default © {year} GovFleet Namibia">
              <Input
                className={inputClass()}
                value={content.footer.copyrightText}
                maxLength={200}
                onChange={(e) => setFooter('copyrightText', e.target.value)}
              />
            </Field>
          </CardContent>
        </Card>

        {/* SEO */}
        <Card className="lg:col-span-2">
          {cardHeader('SEO', 'Meta titles and descriptions per public page (kept within sensible lengths)')}
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              {(
                [
                  ['homepage', 'Homepage'],
                  ['about', 'About'],
                  ['services', 'Services'],
                  ['contact', 'Contact'],
                  ['demo', 'Request Demo'],
                  ['faq', 'FAQ'],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="space-y-4 rounded-[10px] border border-border p-4">
                  <p className="text-sm font-medium text-ink-800">{label}</p>
                  <Field label="Meta title">
                    <Input
                      className={inputClass()}
                      value={content.seo[`${key}Title`]}
                      maxLength={200}
                      onChange={(e) => setSeo(`${key}Title`, e.target.value)}
                    />
                  </Field>
                  <Field label="Meta description">
                    <Textarea
                      className={textareaClass()}
                      rows={2}
                      value={content.seo[`${key}Description`]}
                      maxLength={600}
                      onChange={(e) => setSeo(`${key}Description`, e.target.value)}
                    />
                  </Field>
                </div>
              ))}
            </div>
            <div className="mt-4 max-w-md">
              <Field label="Social share image URL" hint="https:// image used for Open Graph cards">
                <Input
                  className={inputClass()}
                  value={content.seo.socialImageUrl}
                  onChange={(e) => setSeo('socialImageUrl', e.target.value)}
                />
              </Field>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
