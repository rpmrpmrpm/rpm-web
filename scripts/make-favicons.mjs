// Draws the PNG icons from public/favicon.svg, which is a copy of the website's. The PNG for a tab keeps the rounded
// corners. Those for a Home Screen are square, because the phone rounds them itself and leaves no transparent corner.
// Run by hand when the icon changes. The results are committed.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const folder = fileURLToPath(new URL('../public/', import.meta.url));
const svg = readFileSync(`${folder}favicon.svg`, 'utf8');
const square = svg.replace(' rx="14"', '');

const browser = await chromium.launch();

async function draw(source, size, name) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${source}`);
  writeFileSync(`${folder}${name}`, await page.screenshot({ omitBackground: true }));
  await page.close();
}

await draw(svg, 32, 'favicon-32.png');
await draw(square, 180, 'apple-touch-icon.png');
await draw(square, 192, 'icon-192.png');
await draw(square, 512, 'icon-512.png');
await browser.close();
