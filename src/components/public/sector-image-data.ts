/**
 * Optimised, locally bundled imagery for public homepage sector cards.
 *
 * Keeping these as local WebP files avoids remote image dependencies and lets
 * Next.js serve responsive variants while keeping the initial JS bundle small.
 */
export const SECTOR_IMAGE_DATA: Record<string, string> = {
  'government-ministries': '/images/home/sector-government-ministries.webp',
  'regional-councils': '/images/home/sector-regional-councils.webp',
  municipalities: '/images/home/sector-municipalities.webp',
  'public-enterprises': '/images/home/sector-public-enterprises.webp',
  'mining-industry': '/images/home/sector-mining-industry.webp',
  'logistics-providers': '/images/home/sector-logistics-providers.webp',
  'private-organisations': '/images/home/sector-private-organisations.webp',
};
