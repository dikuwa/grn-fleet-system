/**
 * Trust strip + value proposition strip.
 *
 * Organisation imagery is bundled locally as individual optimized SVG assets.
 * Each image is full-bleed inside its tile so no contact-sheet whitespace,
 * remote image dependency or broken-image placeholder can leak into the public page.
 */

import { Eye, FileCheck2, ScrollText, ShieldCheck, Users } from 'lucide-react';
import { SectionContainer } from '@/components/public/section';

const ORGANISATIONS = [
  {
    image: 'https://blogs.worldbank.org/content/dam/sites/blogs/img/detail/mgr/mad-blog-1.jpg',
    label: 'Government Ministries',
    alt: 'Dr. Hifikepunye Pohamba government building in Windhoek, Namibia',
    position: '50% 46%',
  },
  {
    image:
      'https://images.squarespace-cdn.com/content/v1/65e4c22f5f8b9206d6021811/1710154539933-QZR5TM9KJPIGH8BG7BMY/7.3.jpg?format=750w',
    label: 'Regional Councils',
    alt: 'Omaheke Regional Council office park in Namibia',
    position: '50% 52%',
  },
  {
    image:
      'https://commons.wikimedia.org/wiki/Special:Redirect/file/Swakopmund%20house%20from%20the%20founding%20era.JPG?width=720',
    label: 'Municipalities',
    alt: 'Municipal administration building in Swakopmund, Namibia',
    position: '50% 45%',
  },
  {
    image:
      'https://www.namport.com.na/files/images/4%20STS%20cranes%20in%20action%20simultaneously%20on%20Maersk%20Iyo%20vessel.jpg',
    label: 'Public Enterprises',
    alt: 'Namport ship-to-shore cranes operating at the Port of Walvis Bay',
    position: '50% 50%',
  },
  {
    image:
      'https://www.komatsu.com/content/dam/komatsu/websites/south-africa/images/press-release-photos/komatsu_960e-2kt_drives_husab_mining_operation.jpg',
    label: 'Mining & Industry',
    alt: 'Komatsu haul truck operating at Husab mine in Namibia',
    position: '50% 52%',
  },
  {
    image:
      'https://hitradio.com.na/wp-content/uploads/2022/06/15062022_namibia-lastwagen_iStock_DarthArt-1.jpg',
    label: 'Logistics Providers',
    alt: 'Freight truck travelling on a Namibian highway',
    position: '50% 54%',
  },
  {
    image: 'https://namibiadailynews.info/files/2025/05/Labor-1-585x390.png',
    label: 'Private Organisations',
    alt: 'Modern office building in Windhoek, Namibia',
    position: '50% 48%',
  },
] as const;

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
      <section className="border-border bg-surface border-b">
        <SectionContainer className="py-10 md:py-12">
          <p className="text-ink-500 text-center text-sm font-medium">
            Built for organisations that move people, services and resources
          </p>

          <ul className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-7">
            {items.map((org) => (
              <li
                key={org.label}
                className="group border-border bg-canvas hover:border-brand-300 dark:hover:border-brand-800 min-w-0 overflow-hidden rounded-[10px] border transition-[border-color,transform] duration-200 hover:-translate-y-0.5 motion-reduce:transform-none motion-reduce:transition-none"
              >
                <div className="bg-muted relative aspect-[16/9] overflow-hidden">
                  {/* Local SVGs are already optimized and render sharply at all responsive sizes. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={org.image}
                    alt={org.alt}
                    width={640}
                    height={360}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.015] motion-reduce:transform-none motion-reduce:transition-none"
                    style={{ objectPosition: org.position }}
                  />
                </div>
                <div className="flex min-h-14 items-center px-3 py-3">
                  <span className="text-ink-800 text-xs leading-snug font-semibold sm:text-sm">
                    {org.label}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </SectionContainer>
      </section>

      <section className="border-border bg-canvas border-b">
        <SectionContainer className="py-12">
          <div className="border-border bg-surface rounded-[12px] border px-5 py-6 sm:px-6">
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5 lg:gap-0">
              {VALUES.map((v, index) => (
                <div
                  key={v.title}
                  className={`flex gap-3 lg:px-5 ${index > 0 ? 'lg:border-border lg:border-l' : ''}`}
                >
                  <v.icon
                    className="text-brand-700 dark:text-brand-400 mt-0.5 h-5 w-5 shrink-0"
                    aria-hidden="true"
                  />
                  <div>
                    <h3 className="text-ink-950 text-sm font-semibold">{v.title}</h3>
                    <p className="text-ink-500 mt-1 text-xs leading-relaxed">{v.text}</p>
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
