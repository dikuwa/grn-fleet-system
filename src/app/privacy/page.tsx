import Link from 'next/link';
import { APP_NAME } from '@/lib/constants';
import { ArrowLeft } from 'lucide-react';
import { PublicThemeToggle } from '@/components/layout/public-theme-toggle';

export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b border-border bg-surface/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-[800px] items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-800 text-white text-sm font-bold">G</div>
            <span className="text-sm font-semibold text-ink-950">{APP_NAME}</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/" className="flex items-center gap-1 text-sm text-ink-500 hover:text-ink-950 transition-colors">
              <ArrowLeft className="h-4 w-4" /> Back to Home
            </Link>
            <PublicThemeToggle />
          </div>
        </div>
      </header>

      <section className="flex-1 bg-white py-24">
        <div className="mx-auto max-w-[800px] px-6">
          <h1 className="text-3xl font-[650] tracking-tight text-ink-950">Privacy Policy</h1>
          <p className="mt-2 text-sm text-ink-500">Last updated: July 2026</p>

          <div className="mt-8 space-y-6 text-sm leading-relaxed text-ink-700">
            <h2 className="text-base font-semibold text-ink-950">1. Introduction</h2>
            <p>This Privacy Policy explains how the Government Fleet Management System (&quot;GovFleet&quot;, &quot;we&quot;, &quot;our&quot;) collects, uses, and protects your personal information when you use our fleet management platform.</p>

            <h2 className="text-base font-semibold text-ink-950">2. Information We Collect</h2>
            <p>We collect information necessary for fleet operations management:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Account information: name, email address, employee ID, role</li>
              <li>Professional information: job title, department, office location, driver licence details</li>
              <li>Usage data: transport requests, trip logs, vehicle inspections, fuel records</li>
              <li>Device information: browser type, mobile device info for PWA functionality</li>
            </ul>

            <h2 className="text-base font-semibold text-ink-950">3. How We Use Your Information</h2>
            <p>Your information is used solely for fleet management operations:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Processing and approving transport requests</li>
              <li>Allocating vehicles and managing trips</li>
              <li>Recording inspections, fuel usage, and driver logs</li>
              <li>Generating operational reports for government oversight</li>
              <li>Maintaining audit trails for accountability</li>
            </ul>

            <h2 className="text-base font-semibold text-ink-950">4. Data Storage and Security</h2>
            <p>All data is stored in secure, access-controlled databases. We implement appropriate technical and organisational measures to protect your personal information against unauthorised access, alteration, disclosure, or destruction. Data is hosted within secure infrastructure with encryption at rest and in transit.</p>

            <h2 className="text-base font-semibold text-ink-950">5. Data Sharing</h2>
            <p>We do not sell or share your personal information with third parties for marketing purposes. Information may be shared within your government organisation for operational purposes, with authorised system administrators, or as required by law.</p>

            <h2 className="text-base font-semibold text-ink-950">6. Data Retention</h2>
            <p>We retain your information for as long as your account is active or as needed to provide fleet management services. Audit records are retained in accordance with government record-keeping requirements.</p>

            <h2 className="text-base font-semibold text-ink-950">7. Your Rights</h2>
            <p>You have the right to access, correct, or request deletion of your personal information. To exercise these rights, please contact your system administrator or the GovFleet support team.</p>

            <h2 className="text-base font-semibold text-ink-950">8. Contact</h2>
            <p>For privacy-related enquiries, contact: support@govfleet.gov.na</p>
          </div>
        </div>
      </section>

      <footer className="bg-brand-950 py-12">
        <div className="mx-auto max-w-[800px] px-6">
          <p className="text-center text-sm text-white/60">&copy; {new Date().getFullYear()} {APP_NAME}. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
