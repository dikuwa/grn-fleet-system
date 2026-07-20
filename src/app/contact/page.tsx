'use client';

import Link from 'next/link';
import { APP_NAME } from '@/lib/constants';
import { Mail, Phone, MapPin, ArrowLeft } from 'lucide-react';
import { PublicThemeToggle } from '@/components/layout/public-theme-toggle';

export default function ContactPage() {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    alert('Thank you for your message. We will get back to you shortly.');
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b border-border bg-surface/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-800 text-white text-sm font-bold">G</div>
            <span className="text-sm font-semibold text-ink-950">{APP_NAME}</span>
          </Link>
          <PublicThemeToggle />
          <div className="flex items-center gap-4">
            <Link href="/about" className="text-sm text-ink-500 hover:text-ink-950 transition-colors">About</Link>
            <Link href="/services" className="text-sm text-ink-500 hover:text-ink-950 transition-colors">Services</Link>
            <Link href="/" className="flex items-center gap-1 text-sm text-ink-500 hover:text-ink-950 transition-colors">
              <ArrowLeft className="h-4 w-4" /> Back to Home
            </Link>
          </div>
        </div>
      </header>

      <section className="flex-1 bg-gradient-to-b from-canvas to-surface py-24">
        <div className="mx-auto max-w-[700px] px-6">
          <div className="text-center">
            <h1 className="text-3xl font-[650] tracking-tight text-ink-950">Contact Us</h1>
            <p className="mt-4 text-ink-500">
              Get in touch with the GovFleet team for support, demonstrations, or enquiries.
            </p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            <div className="rounded-[10px] border border-border bg-surface p-6 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                <Mail className="h-5 w-5" />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-ink-950">Email</h3>
              <p className="mt-1 text-sm text-ink-500">support@govfleet.gov.na</p>
            </div>
            <div className="rounded-[10px] border border-border bg-surface p-6 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                <Phone className="h-5 w-5" />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-ink-950">Phone</h3>
              <p className="mt-1 text-sm text-ink-500">+264 61 200 7000</p>
            </div>
            <div className="rounded-[10px] border border-border bg-surface p-6 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                <MapPin className="h-5 w-5" />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-ink-950">Office</h3>
              <p className="mt-1 text-sm text-ink-500">Windhoek, Namibia</p>
            </div>
          </div>

          <div className="mt-12 rounded-[10px] border border-border bg-surface p-8">
            <h2 className="text-base font-semibold text-ink-950">Send a Message</h2>              <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-ink-500 mb-1">Name</label>
                  <input type="text" className="h-10 w-full rounded-[8px] border border-border bg-canvas px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200" placeholder="Your name" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-500 mb-1">Email</label>
                  <input type="email" className="h-10 w-full rounded-[8px] border border-border bg-canvas px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200" placeholder="your@email.com" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-500 mb-1">Subject</label>
                <input type="text" className="h-10 w-full rounded-[8px] border border-border bg-canvas px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200" placeholder="How can we help?" />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-500 mb-1">Message</label>
                <textarea rows={5} className="w-full rounded-[8px] border border-border bg-canvas px-3 py-2 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200 resize-none" placeholder="Your message..." />
              </div>
              <button type="submit" className="inline-flex h-10 items-center justify-center rounded-[8px] bg-brand-800 px-5 text-sm font-medium text-white hover:bg-brand-700 transition-colors">
                Send Message
              </button>
            </form>
          </div>
        </div>
      </section>

      <footer className="bg-brand-950 py-12">
        <div className="mx-auto max-w-[1200px] px-6">
          <p className="text-center text-sm text-white/60">&copy; {new Date().getFullYear()} {APP_NAME}. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
