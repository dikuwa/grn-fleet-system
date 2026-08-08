/**
 * FAQ / Resources — practical questions grouped into responsive tabs.
 *
 * CMS entries remain authoritative and editable by Platform Admin. Curated
 * fallback questions are only used while the CMS library is still sparse.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, CalendarCheck2, LayoutDashboard, Workflow } from 'lucide-react';
import { getPublishedFaqs } from '@/lib/platform/cms-public';
import { getPublicSeoContent, publicPageMetadata } from '@/lib/platform/public-metadata';
import { JsonLd } from '@/components/public/json-ld';
import { PageHero } from '@/components/public/page-hero';
import { SectionContainer } from '@/components/public/section';
import { FaqTabs, type FaqGroup } from './faq-tabs';

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getPublicSeoContent();
  return publicPageMetadata(seo, 'faq');
}

interface CuratedFaq {
  id: string;
  category: string;
  question: string;
  answer: string;
}

const CURATED_FAQS: CuratedFaq[] = [
  {
    id: 'curated-demo',
    category: 'getting-started',
    question: 'How do I request a demonstration?',
    answer: 'Use the Request Demo form and tell us your organisation type, approximate fleet size and the operational areas you want to see. The request is sent to the platform team for review and scheduling.',
  },
  {
    id: 'curated-who',
    category: 'general',
    question: 'Who can use the platform?',
    answer: 'The platform is designed for organisations that manage vehicles or transport workflows, including government ministries, regional councils, municipalities, public enterprises, mining and industrial operations, logistics providers and private organisations.',
  },
  {
    id: 'curated-existing-data',
    category: 'getting-started',
    question: 'Can an organisation use its existing staff and vehicle records?',
    answer: 'Yes. Organisation setup supports existing employee numbers and fleet records, while system-generated identifiers can be used where an organisation does not already have them.',
  },
  {
    id: 'curated-workflow',
    category: 'operations',
    question: 'What happens after a transport request is submitted?',
    answer: 'The request moves through the organisation’s configured review and approval workflow. Transport operations can then confirm requirements, allocate an eligible vehicle and driver, prepare authority records and release the trip for operation.',
  },
  {
    id: 'curated-driver',
    category: 'operations',
    question: 'What can drivers do from mobile devices?',
    answer: 'Authorised drivers can use their focused self-service area for assigned trip activity, logs, fuel entries and incident or defect reporting. The platform is designed with mobile use and intermittent connectivity in mind.',
  },
  {
    id: 'curated-documents',
    category: 'operations',
    question: 'Does the platform generate official transport records?',
    answer: 'Yes. Supported workflows can generate controlled transport and trip records from the approved operational data, keeping the document connected to the request, decisions and trip history.',
  },
  {
    id: 'curated-fuel',
    category: 'operations',
    question: 'Can fuel, inspections, defects and maintenance be tracked?',
    answer: 'Yes. These areas are part of the fleet operations workflow so organisations can connect vehicle readiness, fuel activity, defects and maintenance to operational records instead of managing them in isolated spreadsheets.',
  },
  {
    id: 'curated-roles',
    category: 'access-security',
    question: 'How is access controlled?',
    answer: 'Access is role-based. Requesters, approvers, transport staff, drivers, administrators and auditors receive only the routes and actions relevant to their responsibilities, with tenant separation between organisations.',
  },
  {
    id: 'curated-audit',
    category: 'access-security',
    question: 'Is there an audit trail for approvals and changes?',
    answer: 'Yes. Important workflow actions are recorded with the responsible user, timestamp and outcome so organisations can trace how a request or fleet record progressed.',
  },
  {
    id: 'curated-multitenant',
    category: 'access-security',
    question: 'Is data separated between organisations?',
    answer: 'Yes. GovFleet is multi-tenant: each organisation operates in its own workspace with its own users, vehicles, drivers, settings and operational records.',
  },
  {
    id: 'curated-customisation',
    category: 'deployment-support',
    question: 'Can the platform be configured for a specific organisation?',
    answer: 'Yes. Organisation setup can configure users, organisational structure, fleet data, roles and supported operational settings while keeping the core platform consistent and maintainable.',
  },
  {
    id: 'curated-onboarding',
    category: 'deployment-support',
    question: 'What is involved in onboarding a new organisation?',
    answer: 'Onboarding establishes the tenant workspace, subscription package, administrator access and organisation configuration. Staff, vehicles and operational setup can then be prepared for use and testing.',
  },
  {
    id: 'curated-pricing',
    category: 'deployment-support',
    question: 'How are packages and limits handled?',
    answer: 'The platform supports subscription packages with configurable feature entitlements and usage limits. The appropriate package can be selected during tenant onboarding and managed by the platform administrator.',
  },
  {
    id: 'curated-support',
    category: 'deployment-support',
    question: 'How do we get help or discuss our requirements?',
    answer: 'Use the Contact or Request Demo page. The platform team can review your fleet size, current workflow and rollout requirements before recommending the next step.',
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  'getting-started': 'Getting Started',
  general: 'General',
  operations: 'Operations',
  'access-security': 'Access & Security',
  'deployment-support': 'Deployment & Support',
};

const NEXT_STEPS = [
  {
    href: '/#platform',
    title: 'Explore the platform',
    description: 'Review the core fleet capabilities and product previews.',
    icon: LayoutDashboard,
  },
  {
    href: '/#how-it-works',
    title: 'See how the workflow works',
    description: 'Follow the operational journey from request through closure.',
    icon: Workflow,
  },
  {
    href: '/request-demo',
    title: 'Request a demonstration',
    description: 'Arrange a walkthrough around your organisation’s fleet needs.',
    icon: CalendarCheck2,
  },
];

export default async function FaqPage() {
  const published = await getPublishedFaqs().catch(() => []);

  const seenQuestions = new Set(published.map((faq) => faq.question.trim().toLowerCase()));
  const curatedToAdd = published.length >= 10
    ? []
    : CURATED_FAQS.filter(
        (faq) => !seenQuestions.has(faq.question.trim().toLowerCase()),
      );

  const displayFaqs: CuratedFaq[] = [
    ...published.map((faq) => ({
      id: faq.id,
      category: faq.category || 'general',
      question: faq.question,
      answer: faq.answer,
    })),
    ...curatedToAdd,
  ];

  const categoryOrder = ['getting-started', 'general', 'operations', 'access-security', 'deployment-support'];
  const discovered = Array.from(new Set(displayFaqs.map((faq) => faq.category)));
  const orderedCategories = [
    ...categoryOrder.filter((category) => discovered.includes(category)),
    ...discovered.filter((category) => !categoryOrder.includes(category)),
  ];

  const groups: FaqGroup[] = orderedCategories
    .map((category) => ({
      category,
      label: CATEGORY_LABELS[category] || category.replaceAll('-', ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
      items: displayFaqs
        .filter((faq) => faq.category === category)
        .map(({ id, question, answer }) => ({ id, question, answer })),
    }))
    .filter((group) => group.items.length > 0);

  const faqPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: displayFaqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  };

  return (
    <>
      <JsonLd data={faqPageJsonLd} />
      <PageHero
        title="Frequently Asked Questions"
        description="Practical answers for organisations evaluating GovFleet Namibia."
      />

      <section className="border-b border-border bg-canvas py-14 md:py-20">
        <SectionContainer>
          <FaqTabs groups={groups} />
        </SectionContainer>
      </section>

      <section className="bg-surface py-14 md:py-18">
        <SectionContainer>
          <div className="mx-auto max-w-6xl">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-[650] tracking-tight text-ink-950">Choose your next step</h2>
              <p className="mt-3 text-sm leading-relaxed text-ink-500">
                Continue exploring the product, review the workflow, or arrange a demonstration with the platform team.
              </p>
            </div>

            <div className="mt-8 grid border-y border-border md:grid-cols-3">
              {NEXT_STEPS.map((item, index) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`group flex min-h-40 flex-col justify-between py-6 transition-colors hover:bg-muted/50 motion-reduce:transition-none md:px-6 ${
                      index > 0 ? 'border-t border-border md:border-l md:border-t-0' : ''
                    }`}
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                    </span>
                    <span className="mt-6">
                      <span className="flex items-center gap-2 text-sm font-semibold text-ink-950">
                        {item.title}
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
                      </span>
                      <span className="mt-2 block text-sm leading-relaxed text-ink-500">{item.description}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </SectionContainer>
      </section>
    </>
  );
}
