// The views of the collection, with rpm's API answered here: Home, Artists, Genres, the album list, the
// data table, search and playlists.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, test } from 'node:test';

import { chromium } from 'playwright';

const port = 8129;
const site = `http://localhost:${port}`;
const root = new URL('../..', import.meta.url).pathname;
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
await new Promise((done) => setTimeout(done, 2500));
after(() => process.kill(-server.pid));

const browser = await chromium.launch();
after(() => browser.close());

const track = (id, title, artist, album, genre, year, number, albumArtist = artist) => ({
  rpmId: id,
  sha256: id,
  relativePath: `${albumArtist}/${album}/${number} ${title}.flac`,
  title,
  artist,
  album,
  addedAt: 1000 + number,
  tags: { genre, year, trackNumber: number, durationSeconds: 200, albumArtist },
});

const FILES = [
  track('a1', 'Alpha', 'Portishead', 'Dummy', 'Trip Hop', 1994, 1),
  track('a2', 'Beta', 'Portishead', 'Dummy', 'Trip Hop', 1994, 2),
  track('b1', 'Gamma', 'Radiohead', 'Kid A', 'Rock', 2000, 1),
  track('c1', 'Delta', 'Calvin Harris feat. Ellie Goulding', '18 Months', 'House', 2012, 1, 'Calvin Harris'),
  track('d1', 'Epsilon', 'Ellie Goulding', 'Halcyon', 'Pop', 2012, 1),
];

async function open(viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage({ viewport });
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error)));
  const playlists = [{ playlistId: 'p1', name: 'Road trip', trackIds: ['a1', 'gone'], folder: [], updatedAt: 5 }];
  const answer = (route, status, body = {}) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route(`${site}/accounts/**`, (route) => {
    const path = new URL(route.request().url()).pathname.replace('/accounts/', '');
    if (path === 'auth/refresh') return answer(route, 200, { accessToken: 'token', expiresIn: 3600 });
    if (path === 'auth/me') return answer(route, 200, { userId: `user-${Math.random()}`, email: 'a@b.c', displayName: 'A', grSupporter: true, grTester: true });
    return answer(route, 404);
  });
  await page.route(`${site}/api/**`, (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/', '');
    const method = route.request().method();
    if (path === 'cloud/list') return answer(route, 200, { files: FILES, nextCursor: null });
    if (path === 'cloud/playlists') return answer(route, 200, { playlists });
    if (path === 'cloud/moodlists') return answer(route, 404);
    if (path === 'cloud/track-plays') return answer(route, 200, { tracks: [] });
    if (path.startsWith('cloud/playlist/') && method === 'PUT') {
      const body = route.request().postDataJSON();
      const id = path.split('/').pop();
      const held = playlists.find((row) => row.playlistId === id);
      if (held) Object.assign(held, body, { updatedAt: held.updatedAt + 1 });
      else playlists.push({ playlistId: id, folder: [], updatedAt: 1, ...body });
      return answer(route, 200, {});
    }
    if (path.startsWith('cloud/playlist/') && method === 'DELETE') {
      playlists.splice(playlists.findIndex((row) => path.endsWith(row.playlistId)), 1);
      return route.fulfill({ status: 204 });
    }
    return answer(route, 200, {});
  });

  await page.goto(site);
  await page.waitForSelector('.rail');
  await page.waitForSelector('.card');
  return { page, playlists, problems };
}

const rail = (page, name) => page.click(`.rail button:has-text("${name}")`);

test('Home starts with Recently added, and opens a record', async () => {
  const { page, problems } = await open();

  await page.waitForSelector('h3:has-text("Recently added")');
  assert.equal(await page.$('h3:has-text("Recently listened")'), null);

  await page.click('.card >> nth=0');
  await page.waitForSelector('[role=dialog] .track');
  assert.deepEqual(problems, []);
  await page.close();
});

test('Artists files each act once, a guest included, and opens a page', async () => {
  const { page, problems } = await open();

  await rail(page, 'Artists');
  await page.waitForSelector('text=Portishead');
  const names = await page.$$eval('.page ul strong', (rows) => rows.map((row) => row.textContent));
  assert.deepEqual(names, ['Calvin Harris', 'Ellie Goulding', 'Portishead', 'Radiohead']);

  await page.click('strong:text-is("Ellie Goulding")');
  await page.waitForSelector('h3:has-text("Appears on")');
  await page.waitForSelector('.song:has-text("Delta")');
  await page.waitForSelector('.song:has-text("Epsilon")');

  await page.click('button:has-text("Back to artists")');
  await page.fill('input[type=search]', 'radio');
  await page.waitForFunction(() => document.querySelectorAll('.page ul strong').length === 1);
  assert.deepEqual(problems, []);
  await page.close();
});

test('Genres files records on the shelves the other apps use', async () => {
  const { page, problems } = await open();

  await rail(page, 'Genres');
  await page.waitForSelector('strong:text-is("Rock")');
  await page.waitForSelector('strong:text-is("House")');
  await page.click('strong:text-is("Rock")');
  await page.waitForSelector('h3:has-text("2000")');
  assert.deepEqual(problems, []);
  await page.close();
});

test('The album list and the data table show the same collection', async () => {
  const { page, problems } = await open();

  await rail(page, 'Albums');
  await page.click('button[aria-label="Album list"]');
  await page.waitForSelector('.line:has-text("Kid A")');

  await page.click('button[aria-label="Data table"]');
  await page.waitForSelector('.row:has-text("Gamma")');
  assert.equal((await page.$$('.table .row')).length, FILES.length);

  await page.click('.head button:text-is("Year")');
  await page.waitForFunction(() => document.querySelector('.table .row .title')?.textContent === 'Alpha');
  await page.click('.head button:text-is("Year")');
  await page.waitForFunction(() => ['Delta', 'Epsilon'].includes(document.querySelector('.table .row .title')?.textContent));

  await page.fill('input[type=search]', 'gamm');
  await page.waitForFunction(() => document.querySelectorAll('.table .row').length === 1);
  assert.deepEqual(problems, []);
  await page.close();
});

test('Playlists says what is in the desktop app, and can be made and filled here', async () => {
  const { page, playlists, problems } = await open();

  await rail(page, 'Playlists');
  await page.waitForSelector('text=Auto playlists, mood lists and smart playlists');
  await page.waitForSelector('strong:text-is("Road trip")');

  await page.click('button:text-is("New playlist")');
  await page.fill('form input', 'Fresh');
  await page.click('form button[type=submit]');
  await page.waitForSelector('strong:text-is("Fresh")');
  assert.equal(playlists.length, 2);

  await page.click('strong:text-is("Road trip")');
  await page.waitForSelector('text=1 track isn');
  await page.waitForSelector('.song:has-text("Alpha")');
  await page.click('button[aria-label="Remove from playlist"]');
  await page.waitForFunction(() => document.querySelectorAll('.song').length === 0);
  assert.deepEqual(playlists[0].trackIds, ['gone']);

  await page.click('button:text-is("Delete")');
  await page.waitForSelector('strong:text-is("Fresh")');
  assert.equal(playlists.length, 1);

  await rail(page, 'Home');
  await page.click('.card >> nth=0');
  await page.click('button:has-text("Add to playlist")');
  await page.click('[role=dialog] li button:has-text("Fresh")');
  await page.waitForFunction(() => document.querySelectorAll('[role=dialog]').length === 1);
  assert.ok(playlists[0].trackIds.length > 0);
  assert.deepEqual(problems, []);
  await page.close();
});

test('On a phone the views are under one tab, with a picker', async () => {
  const { page, problems } = await open();
  await page.setViewportSize({ width: 390, height: 844 });

  await page.click('nav.tabs button:has-text("Albums")');
  await page.click('.picks button:has-text("Artists")');
  await page.waitForSelector('strong:text-is("Portishead")');
  await page.click('.picks button:has-text("Playlists")');
  await page.waitForSelector('strong:text-is("Road trip")');
  assert.deepEqual(problems, []);
  await page.close();
});
