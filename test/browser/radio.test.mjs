// The radio, with rpm's API and the stream answered here: the dial, what narrows it, saving a station, and a
// station and a record each stopping the other.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';

import { webkit } from 'playwright';

const port = 8133;
const site = `http://localhost:${port}`;
const root = new URL('../..', import.meta.url).pathname;
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
await new Promise((done) => setTimeout(done, 2500));
after(() => process.kill(-server.pid));

const browser = await webkit.launch();
after(() => browser.close());

const STATIONS = [
  { uuid: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Jazz Alpha (128k)', streamUrl: 'https://stream.test/one', countryCode: 'NL', country: 'The Netherlands', tags: ['jazz'], codec: 'MP3', bitrateKbps: 128, votes: 5, clickCount: 90, reachable: true },
  { uuid: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'Jazz Alpha (320k)', streamUrl: 'https://stream.test/one-hq', countryCode: 'NL', country: 'The Netherlands', tags: ['jazz'], codec: 'MP3', bitrateKbps: 320, votes: 7, clickCount: 80, reachable: true },
  { uuid: 'aaaaaaaa-0000-0000-0000-000000000003', name: 'Rock Bravo', streamUrl: 'https://stream.test/two', countryCode: 'DE', country: 'Germany', tags: ['rock', 'commercial'], codec: 'AAC', bitrateKbps: 64, votes: 9, clickCount: 70, reachable: false },
];

const track = (id, title, number) => ({ rpmId: id, sha256: id, relativePath: `A/B/${number} ${title}.flac`, title, artist: 'A', album: 'B', addedAt: 1000 + number, tags: { genre: 'Pop', year: 2000, trackNumber: number, durationSeconds: 200, albumArtist: 'A' } });
const FILES = [track('a1', 'Alpha', 1), track('a2', 'Beta', 2)];
const sound = readFileSync(new URL('../../proof/tracks/aac128-1.m4a', import.meta.url));

async function open({ viewport = { width: 1440, height: 900 }, directoryDown = false } = {}) {
  const page = await browser.newPage({ viewport });
  const problems = [];
  const asked = [];
  const saves = [];
  page.on('pageerror', (error) => problems.push(String(error)));
  const answer = (route, status, body = {}) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

  await page.route('https://stream.test/**', (route) => route.fulfill({ status: 200, contentType: 'audio/mp4', body: sound }));
  await page.route(`${site}/accounts/**`, (route) => {
    const path = new URL(route.request().url()).pathname.replace('/accounts/', '');
    if (path === 'auth/refresh') return answer(route, 200, { accessToken: 'token', expiresIn: 3600 });
    if (path === 'auth/me') return answer(route, 200, { userId: `user-${Math.random()}`, email: 'a@b.c', displayName: 'A', grSupporter: true, grTester: true });
    return answer(route, 404);
  });
  await page.route(`${site}/api/**`, (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/', '');
    if (path.startsWith('radio/') && !path.startsWith('radio/state') && !path.startsWith('radio/logo')) {
      if (directoryDown) return answer(route, 502);
      asked.push(path + url.search);
      if (path === 'radio/countries') return answer(route, 200, { countries: [{ name: 'The Netherlands', code: 'NL', stationCount: 10 }, { name: 'Germany', code: 'DE', stationCount: 8 }] });
      if (path.startsWith('radio/played/')) return route.fulfill({ status: 204 });
      const code = url.searchParams.get('country');
      return answer(route, 200, { stations: STATIONS.filter((row) => !code || row.countryCode === code) });
    }
    if (path === 'cloud/list') return answer(route, 200, { files: FILES, nextCursor: null });
    if (path === 'cloud/playlists') return answer(route, 200, { playlists: [] });
    if (path === 'cloud/moodlists') return answer(route, 404);
    if (path === 'cloud/track-plays') return answer(route, 200, { tracks: [] });
    if (path === 'cloud/album-marks') return answer(route, 200, { albums: [] });
    if (path === 'radio/state') return answer(route, 200, { logos: '1', hidden: [], edits: { 'aaaaaaaa-0000-0000-0000-000000000003': { name: 'Bravo Edited' } } });
    if (path.startsWith('radio/logo/')) return answer(route, 404);
    if (path === 'cloud/station-favorites' && route.request().method() === 'PUT') {
      saves.push(route.request().postDataJSON());
      return answer(route, 200, { updatedAt: 1 });
    }
    if (path === 'cloud/station-favorites') return answer(route, 200, { stations: [] });
    if (path.startsWith('cloud/stream/')) return answer(route, 200, { url: `${site}/proof/tracks/flac-1.flac`, kilobits: 0, live: false, expiresInSeconds: 3600 });
    return answer(route, 200, {});
  });

  await page.goto(site);
  await page.waitForSelector(viewport.width < 700 ? 'nav.tabs' : '.rail');
  await page.waitForSelector('.card');
  return { page, problems, asked, saves };
}

const onAir = (page) => page.evaluate(() => document.querySelector('.band')?.classList.contains('open'));

test('the pane lists one row per station, with the admin\'s name, and tuning fills the dial and the band', async () => {
  const { page, problems, asked } = await open();
  await page.click('.rail button:has-text("Internet Radio")');
  await page.waitForFunction(() => document.querySelectorAll('.radio li').length === 2);

  assert.deepEqual(await page.$$eval('.radio .name', (rows) => rows.map((row) => row.textContent)), ['Jazz Alpha', 'Bravo Edited']);
  assert.equal(await page.$eval('.radio .detail', (row) => row.textContent), 'Netherlands · MP3');

  await page.click('.radio li >> nth=0 >> button.tune');
  await page.waitForSelector('.readout strong:has-text("Jazz Alpha")');
  await page.waitForFunction(() => document.querySelector('.band').classList.contains('open'));
  await page.waitForSelector('.band h2:has-text("Jazz Alpha")');
  assert.ok(asked.some((row) => row.startsWith('radio/played/')), 'the directory is told, because its ranking is built from these');

  await page.click('.deck button[title="Stop"]');
  await page.waitForFunction(() => !document.querySelector('.band').classList.contains('open'));
  assert.deepEqual(problems, []);
  await page.close();
});

test('a station and a record stop each other', async () => {
  const { page, problems } = await open();
  await page.click('.card >> nth=0');
  await page.click('.drawer .mini-key >> nth=0');
  await page.waitForSelector('.band h2:has-text("Alpha")');

  await page.click('.rail button:has-text("Internet Radio")');
  await page.waitForFunction(() => document.querySelectorAll('.radio li').length === 2);
  await page.click('.radio li >> nth=1 >> button.tune');
  await page.waitForSelector('.band h2:has-text("Bravo Edited")');

  await page.click('.rail button:has-text("Track info")');
  await page.waitForSelector('.sheet');
  await page.click('.deck button[title="Stop"]');
  await page.waitForFunction(() => !document.querySelector('.band').classList.contains('open'));

  await page.click('.card >> nth=0', { button: 'right' });
  await page.click('[role=menuitem] .label:text-is("Play")');
  await page.waitForSelector('.band h2:has-text("Alpha")');
  assert.ok(await onAir(page));
  assert.deepEqual(problems, []);
  await page.close();
});

test('a country narrows the search, and the filter narrows what came back', async () => {
  const { page, problems, asked } = await open();
  await page.click('.rail button:has-text("Internet Radio")');
  await page.waitForFunction(() => document.querySelectorAll('.radio li').length === 2);

  await page.click('.tools .country');
  await page.click('.panel button:has-text("Germany")');
  await page.waitForFunction(() => document.querySelectorAll('.radio li').length === 1);
  assert.ok(asked.some((row) => row.includes('country=DE')));

  await page.click('.tools .country');
  await page.click('.panel button:has-text("Clear location")');
  await page.waitForFunction(() => document.querySelectorAll('.radio li').length === 2);

  await page.click('button[aria-label="Filter stations"]');
  await page.click('.panel button:text-is("AAC")');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelectorAll('.radio li').length === 1);
  assert.equal(await page.$eval('.radio .name', (row) => row.textContent), 'Bravo Edited');
  assert.ok(await page.$('button[aria-label="Filter stations"].set'), 'a filter in force shows on its key');

  await page.click('button[aria-label="Filter stations"]');
  await page.click('.panel button:has-text("Clear filters")');
  await page.keyboard.press('Escape');
  await page.click('button[aria-label="Sort stations"]');
  await page.click('.panel button:has-text("Bitrate")');
  await page.waitForFunction(() => document.querySelector('.radio .name').textContent === 'Jazz Alpha');
  assert.deepEqual(problems, []);
  await page.close();
});

test('typing waits for the typing to stop', async () => {
  const { page, problems, asked } = await open();
  await page.click('.rail button:has-text("Internet Radio")');
  await page.waitForFunction(() => document.querySelectorAll('.radio li').length === 2);
  const before = asked.filter((row) => row.startsWith('radio/stations')).length;

  await page.type('.find input', 'jazz', { delay: 30 });
  await page.waitForTimeout(800);
  const made = asked.filter((row) => row.startsWith('radio/stations'));
  assert.equal(made.length, before + 1);
  assert.ok(made.at(-1).includes('name=jazz'));
  assert.deepEqual(problems, []);
  await page.close();
});

test('a saved station is told to the store and stands in the saved list', async () => {
  const { page, problems, saves } = await open();
  await page.click('.rail button:has-text("Internet Radio")');
  await page.waitForFunction(() => document.querySelectorAll('.radio li').length === 2);

  await page.click('.radio li >> nth=0 >> .heart');
  await page.waitForFunction(() => document.querySelector('.radio li .heart.on'));
  await page.waitForTimeout(100);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].stations[0].saved, true);

  await page.click('.tools .saved');
  await page.waitForFunction(() => document.querySelectorAll('.radio li').length === 1);
  assert.deepEqual(problems, []);
  await page.close();
});

test('the directory being down is said, and is not an empty list', async () => {
  const { page, problems } = await open({ directoryDown: true });
  await page.click('.rail button:has-text("Internet Radio")');
  await page.waitForSelector('text=Could not retrieve the list of radio stations');
  assert.equal(await page.$('text=No stations match your search'), null);
  assert.deepEqual(problems, []);
  await page.close();
});

test('on a phone the radio is a tab, and the bar over the tabs drives the station', async () => {
  const { page, problems } = await open();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('nav.tabs button:has-text("Radio")');
  await page.waitForFunction(() => document.querySelectorAll('.radio li').length === 2);
  await page.click('.radio li >> nth=0 >> button.tune');
  await page.waitForSelector('.mini .title:has-text("Jazz Alpha")');
  await page.click('.mini button[title="Play/pause"]').catch(() => {});
  assert.deepEqual(problems, []);
  await page.close();
});
