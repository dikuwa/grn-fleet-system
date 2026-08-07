/**
 * Generate PNG PWA icons from the SVG sources.
 *
 * Chrome does not accept SVG files in web app manifests ("resource isn't a
 * valid image"), so the manifest must reference PNG icons. This script
 * rasterises the existing SVGs with sharp and writes the PNGs next to them.
 *
 * Usage (from repo root):
 *   node scripts/generate-pwa-icons.mjs
 */
import fs from 'node:fs';
import sharp from 'sharp';

const ICONS = [
  { svg: 'public/icons/icon-192.svg', png: 'public/icons/icon-192.png', size: 192 },
  { svg: 'public/icons/icon-512.svg', png: 'public/icons/icon-512.png', size: 512 },
];

for (const { svg, png, size } of ICONS) {
  if (!fs.existsSync(svg)) {
    console.warn(`skip (missing source): ${svg}`);
    continue;
  }
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(png);
  console.log(`wrote ${png} (${size}x${size})`);
}
