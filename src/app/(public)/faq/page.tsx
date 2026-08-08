/**
 * FAQ — full public FAQ page.
 *
 * Server Component: loads all published FAQs (CMS-editable by Platform
 * Admin) and groups them by category in display order. Renders the same
 * accessible accordion used on the homepage.
 */

import type { Metadata } from 'next';
import {
  getPublishedFaqs,
  getPublishedFaqCategories,
} from '@/lib/platform/cms-public';
import type { PublicFaq } from '@/lib/platform/cms-public';
import { PageHero } from '@/components/public/page-hero';
import { SectionContainer } from '@/components/public/section';
import { FaqAccordion } from './faq-accordion';

export const metadata: Metadata = {
  title: 'FAQ | GovFleet Namibia',
  description:
    'Answers to the questions organisations ask most about GovFleet digital fleet management.',
};

export default async function FaqPage() {
  let faqs: PublicFaq[] = [];
  let categories: string[] = ['general'];
  try {
    [faqs, categories] = await Promise.all([
      getPublishedFaqs(),
      getPublishedFaqCategories(),
    ]);
  } catch {
    // empty state below
  }

  if (faqs.length === 0) {
    return (
      <>
        <PageHero
          eyebrow="FAQ"
          title="Frequently Asked Questions"
          description="Answers to the questions prospective organisations ask most."
        />
        <section className="bg-canvas py-20">
          <SectionContainer>
            <p className="text-center text-ink-500">
              No FAQs published yet. Check back soon.
            </p>
          </SectionContainer>
        </section>
      </>
    );
  }

  const grouped = categories
    .map((category) => ({
      category,
      items: faqs.filter((f) => (f.category || 'general') === category),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <>
      <PageHero
        eyebrow="FAQ"
        title="Frequently Asked Questions"
        description="Answers to the questions prospective organisations ask most."
      />
      <section className="bg-canvas py-16 md:py-20">
        <SectionContainer>
          <div className="mx-auto max-w-3xl space-y-10">
            {grouped.map((group) => (
              <div key={group.category}>
                <h2 className="text-sm font-semibold uppercase tracking-widest text-brand-700 dark:text-brand-400">
                  {group.category}
                </h2>
                <div className="mt-4 space-y-3">
                  <FaqAccordion items={group.items} />
                </div>
              </div>
            ))}
          </div>
        </SectionContainer>
      </section>
    </>
  );
}
