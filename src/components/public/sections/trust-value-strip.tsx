/**
 * Trust strip + value proposition strip.
 *
 * Organisation types use lightweight editorial imagery rather than logos or
 * icon tiles. Images are requested from Unsplash at card-sized WebP quality,
 * lazy-loaded and decoded asynchronously so the section stays visual without
 * becoming the homepage's performance bottleneck.
 */

import {
  Eye,
  FileCheck2,
  ScrollText,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { SectionContainer } from '@/components/public/section';

const ORGANISATIONS = [
  {
    label: 'Government Ministries',
    image:
      'https://images.unsplash.com/photo-1764050445785-6eac7a808616?fit=crop&fm=webp&q=68&w=640',
    alt: 'Modern public-sector office building',
    position: '50% 45%',
  },
  {
    label: 'Regional Councils',
    image:
      'https://images.unsplash.com/photo-1751799179162-3c5ae641999e?fit=crop&fm=webp&q=68&w=640',
    alt: 'Contemporary regional administration building',
    position: '50% 48%',
  },
  {
    label: 'Municipalities',
    image:
      'https://images.unsplash.com/photo-1774116196662-a9e1e4fa1612?fit=crop&fm=webp&q=68&w=640',
    alt: 'Urban civic and municipal environment',
    position: '50% 61%',
  },
  {
    label: 'Public Enterprises',
    image:
      'https://images.unsplash.com/photo-1755176226778-13f234648d89?fit=crop&fm=webp&q=68&w=640',
    alt: 'Large modern institutional office building',
    position: '50% 48%',
  },
  {
    label: 'Mining & Industry',
    image:
      'https://images.unsplash.com/photo-1544531697-0f624508b0d4?fit=crop&fm=webp&q=68&w=640',
    alt: 'Heavy mining equipment operating underground',
    position: '50% 55%',
  },
  {
    label: 'Logistics Providers',
    image:
      'https://images.unsplash.com/photo-1776521905669-97fa944bf30c?fit=crop&fm=webp&q=68&w=640',
    alt: 'Commercial truck travelling on a highway',
    position: '50% 62%',
  },
  {
    label: 'Private Organisations',
    image:
      'https://images.unsplash.com/photo-1774544368113-b66148dab467?fit=crop&fm=webp&q=68&w=640',
    alt: 'Modern commercial office building',
    position: '50% 48%',
  },
];

const VALUES = [
  {
    icon: ShieldCheck,
    title: 'Secure & Traceable',
    text: 'Every action is logged and attributed to a user.',
  },
  {
    icon: Users,
    title: 'Role-Based Access',
    text: 'Each role sees only what it must act on.',
  },
  {
    icon: Eye,
    title: 'Real-Time Visibility',
    text: 'Live status of requests, trips and fleet activity.',
  },
  {
    icon: FileCheck2,
    title: 'Paperless Operations',
    text: 'Digital forms replace paper transport records.',
  },
  {
    icon: ScrollText,
    title: 'Audit-Ready Records',
    text: 'A complete digital trail from request to closure.',
  },
];

export interface TrustValueStripProps {
  orgs?: string[];
}

export function TrustValueStrip({ orgs }: TrustValueStripProps) {
  const items = orgs?.length
    ? orgs.map((label, index) => ({ ...ORGANISATIONS[index % ORGANISATIONS.length], label }))
    : ORGANISATIONS;

  return (
    <>
      <section className="border-b border-border bg-surface">
        <SectionContainer className="py-10 md:py-12">
          <p className="text-center text-sm font-medium text-ink-500">
            Built for organisations that move people, services and resources
          </p>

          <ul className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-7">
            {items.map((org) => (
              <li
                key={org.label}
                className="group min-w-0 overflow-hidden rounded-[10px] border border-border bg-canvas transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-brand-300 motion-reduce:transform-none motion-reduce:transition-none dark:hover:border-brand-800"
              >
                <div className="relative aspect-[4/3] overflow-hidden bg-muted">
                  {/* Remote images are intentionally card-sized, WebP and lazy. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={org.image}
                    alt={org.alt}
                    width={640}
                    height={480}
                    loading="lazy"
                    decoding="async"
                    fetchPriority="low"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover opacity-90 transition-[transform,opacity] duration-300 group-hover:scale-[1.015] group-hover:opacity-100 motion-reduce:transform-none motion-reduce:transition-none"
                    style={{ objectPosition: org.position }}
                  />
                  <div className="pointer-events-none absolute inset-0 border-b border-white/5 bg-brand-950/10" aria-hidden="true" />
                </div>
                <div className="flex min-h-14 items-center px-3 py-3">
                  <span className="text-xs font-semibold leading-snug text-ink-800 sm:text-sm">
                    {org.label}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </SectionContainer>
      </section>

      <section className="border-b border-border bg-canvas">
        <SectionContainer className="py-12">
          <div className="rounded-[12px] border border-border bg-surface px-5 py-6 sm:px-6">
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5 lg:gap-0">
              {VALUES.map((v, index) => (
                <div
                  key={v.title}
                  className={`flex gap-3 lg:px-5 ${index > 0 ? 'lg:border-l lg:border-border' : ''}`}
                >
                  <v.icon className="mt-0.5 h-5 w-5 shrink-0 text-brand-700 dark:text-brand-400" aria-hidden="true" />
                  <div>
                    <h3 className="text-sm font-semibold text-ink-950">{v.title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-ink-500">{v.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SectionContainer>
      </section>
    </>
  );
}
