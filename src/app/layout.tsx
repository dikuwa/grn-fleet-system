import type { Metadata, Viewport } from 'next';
import { Onest } from 'next/font/google';
import { APP_NAME, APP_DESCRIPTION } from '@/lib/constants';
import { cn } from '@/lib/utils';
import './globals.css';

const onest = Onest({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-onest',
});

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s | ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  keywords: ['fleet management', 'government', 'Namibia', 'transport'],
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
  return (
    <html lang="en" className={cn(onest.variable)} suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content={APP_NAME} />
      </head>
      <body className="min-h-screen antialiased" style={{ fontFamily: 'var(--font-onest), sans-serif' }}>
        <ServiceWorkerRegistration />
        <ThemeProvider>
          <Providers>{children}</Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
