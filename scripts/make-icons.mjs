// Writes the icon font: a subset of Font Awesome with only the glyphs in src/design/icons.ts. It uses
// Font Awesome Pro where ../rpm-fonts-pro is checked out, and Font Awesome Free otherwise, where a
// Pro-only icon shows as a blank. The output is not committed, because the licence does not allow
// publishing the Pro files.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import subsetFont from 'subset-font';

const root = new URL('..', import.meta.url).pathname;
const source = readFileSync(`${root}src/design/icons.ts`, 'utf8');
const glyphs = [...source.matchAll(/\\u([0-9a-f]{4})/g)].map((match) => String.fromCodePoint(parseInt(match[1], 16))).join('');

mkdirSync(`${root}public/fonts`, { recursive: true });

// The regular face holds the one outline in the app, a heart that is not marked.
for (const [face, wanted, output] of [['fa-solid-900', glyphs, 'icons'], ['fa-regular-400', '\uf004', 'icons-regular']]) {
  const pro = `${root}../rpm-fonts-pro/${face}.ttf`;
  const free = `${root}node_modules/@fortawesome/fontawesome-free/webfonts/${face}.ttf`;
  const from = existsSync(pro) ? pro : free;

  const font = await subsetFont(readFileSync(from), wanted, { targetFormat: 'woff2' });
  writeFileSync(`${root}public/fonts/${output}.woff2`, font);
  console.log(`${output}: ${[...wanted].length} glyphs from ${from === pro ? 'Font Awesome Pro' : 'Font Awesome Free'}, ${font.length} bytes`);
}
