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
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1f4e8c',
};

import { Providers } from '@/lib/providers';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn(onest.variable)}>
      <body className="min-h-screen antialiased" style={{ fontFamily: 'var(--font-onest), sans-serif' }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
