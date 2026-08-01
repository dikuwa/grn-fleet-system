import type { Metadata, Viewport } from 'next';
import { Allura, Onest } from 'next/font/google';
import { APP_NAME, APP_DESCRIPTION } from '@/lib/constants';
import { cn } from '@/lib/utils';
import './globals.css';

const onest = Onest({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-onest',
});
const allura = Allura({
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
  variable: '--font-allura',
});

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s | ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  keywords: [
    'fleet management',
    'transport management',
    'government',
    'municipality',
    'regional council',
    'mining',
    'logistics',
    'private fleet',
    'NGO',
    'Namibia',
    'vehicle allocation',
    'fuel management',
    'maintenance',
    'transport',
  ],
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: APP_NAME,
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#1f4e8c',
};

import { Providers } from '@/lib/providers';
import { ThemeProvider } from '@/lib/theme-provider';
import { ServiceWorkerRegistration } from '@/components/layout/service-worker-registration';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Determine initial theme server-side (light is safe default, client will hydrate)
  const themeScript = `
    (function() {
      try {
        var t = localStorage.getItem('govfleet-theme');
        var isDark = false;
        if (t === 'dark') isDark = true;
        else if (t === 'system' || !t) isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.classList.toggle('dark', isDark);
        document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
      } catch(e) {}
    })();
  `;

  return (
    <html lang="en" className={cn(onest.variable, allura.variable)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="manifest" href="/manifest.json" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content={APP_NAME} />
      </head>
      <body
        className="min-h-screen antialiased"
        style={{ fontFamily: 'var(--font-onest), sans-serif' }}
      >
        <ServiceWorkerRegistration />
        <ThemeProvider>
          <Providers>{children}</Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
