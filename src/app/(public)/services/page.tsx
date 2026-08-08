import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getPublicSeoContent, publicPageMetadata } from '@/lib/platform/public-metadata';

/**
 * The product story now lives on the homepage. Keep this legacy route so old
 * links and search results remain valid, but send visitors directly to the
 * consolidated Platform section instead of showing duplicate content.
 */
export async function generateMetadata(): Promise<Metadata> {
  const seo = await getPublicSeoContent();
  return publicPageMetadata(seo, 'services');
}

export default function ServicesPage() {
  redirect('/#platform');
}
