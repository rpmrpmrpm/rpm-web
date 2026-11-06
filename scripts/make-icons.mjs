// Writes the icon font: a subset of Font Awesome with only the glyphs in src/design/icons.ts. It uses
// Font Awesome Pro where ../rpm-fonts-pro is checked out, and Font Awesome Free otherwise, where a
// Pro-only icon shows as a blank. The output is not committed, because the licence does not allow
// publishing the Pro files.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import subsetFont from 'subset-font';

const root = new URL('..', import.meta.url).pathname;
const source = readFileSync(`${root}src/design/icons.ts`, 'utf8');
const glyphs = [...source.matchAll(/\\u([0-9a-f]{4})/g)].map((match) => String.fromCodePoint(parseInt(match[1], 16))).join('');

const pro = `${root}../rpm-fonts-pro/fa-solid-900.ttf`;
const free = `${root}node_modules/@fortawesome/fontawesome-free/webfonts/fa-solid-900.ttf`;
const from = existsSync(pro) ? pro : free;

const font = await subsetFont(readFileSync(from), glyphs, { targetFormat: 'woff2' });
mkdirSync(`${root}public/fonts`, { recursive: true });
writeFileSync(`${root}public/fonts/icons.woff2`, font);
console.log(`icons: ${[...glyphs].length} glyphs from ${from === pro ? 'Font Awesome Pro' : 'Font Awesome Free'}, ${font.length} bytes`);
