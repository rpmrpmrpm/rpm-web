// The edit windows over a full library: what each one sends when it saves. The row goes through the catalogue
// push, every other tag through the track's sidecar, and an emptied field is named so the store empties it.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, test } from 'node:test';

import { chromium } from 'playwright';

import { coverKeysOn, FILES, serve } from './fixture.mjs';

const port = 8133;
const site = `http://localhost:${port}`;
const root = new URL('../..', import.meta.url).pathname;
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
await new Promise((done) => setTimeout(done, 2500));
after(() => process.kill(-server.pid));

const browser = await chromium.launch();
after(() => browser.close());

const sidecarOf = (id) => {
  const file = FILES.find((row) => row.rpmId === id);
  return { Version: 5, RpmId: id, RelativePath: file.relativePath, Extension: '.flac', Title: file.title, Artist: file.artist, Album: file.album, Genre: file.tags.genre, Year: file.tags.year, TrackNumber: file.tags.trackNumber, Publisher: 'Island', Lyrics: 'La la la', Favorite: id.endsWith('-1') };
};

async function open() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error)));
  await serve(page, site);
  const pushes = [];
  const written = new Map();
  await page.route(`${site}/api/cloud/catalog/tags`, async (route) => {
    pushes.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"updated":1}' });
  });
  await page.route(`${site}/api/cloud/sidecar/**`, (route) => {
    const parts = new URL(route.request().url()).pathname.split('/');
    const id = decodeURIComponent(parts[4]);
    const url = parts[5] === 'upload' ? `https://store.test/put/${id}` : `https://store.test/get/${id}`;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url, expiresInSeconds: 600 }) });
  });
  await page.route('https://store.test/**', async (route) => {
    const [, kind, id] = new URL(route.request().url()).pathname.split('/');
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, PUT', 'access-control-allow-headers': '*' } });
    if (kind === 'put') {
      written.set(decodeURIComponent(id), JSON.parse(route.request().postData()));
      return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(written.get(decodeURIComponent(id)) ?? sidecarOf(decodeURIComponent(id))) });
  });
  await page.goto(site);
  await page.waitForSelector('.rail, .tabs');
  await coverKeysOn(page);
  await page.reload();
  await page.waitForSelector('.rail, .tabs');
  await page.waitForTimeout(500);
  problems.length = 0;
  return { page, pushes, written, problems, close: () => context.close() };
}

const box = (page, label) => page.locator(`.rows input:not([type=checkbox])[aria-label="${label}"], .rows select[aria-label="${label}"], .rows textarea[aria-label="${label}"]`).first();

test('the track editor shows every tag of the sidecar, and saves the row and the sidecar apart', async () => {
  const { page, pushes, written, problems, close } = await open();
  await page.click('.rail button:has-text("Albums")');
  await page.click('button[aria-label="Data table"]');
  await page.waitForSelector('.table .row');
  await page.click('.table .row >> nth=0', { button: 'right' });
  await page.click('text=Edit track…');
  await page.waitForSelector('[role=tab]:has-text("Credits")');

  // A field only the sidecar holds is read into its box.
  await page.click('[role=tab]:has-text("Credits")');
  assert.equal(await box(page, 'Publisher / label').inputValue(), 'Island');
  await box(page, 'Publisher / label').fill('Polydor');

  // An emptied row field is named, so the store empties it.
  await page.click('[role=tab]:has-text("Basics")');
  await box(page, 'Genre').fill('');
  await page.click('button:has-text("Save")');
  await page.waitForSelector('[role=dialog]', { state: 'detached' });

  assert.equal(pushes.length, 1);
  const [item] = pushes[0].items;
  assert.deepEqual(item.clear, ['genre']);
  assert.equal(item.tags, undefined, 'a clear alone sends no tags, so no mark is written');
  assert.equal(item.sidecar, true, 'the row says the sidecar was rewritten, so a computer holding the file reads it');
  const [id] = [...written.keys()];
  assert.equal(written.get(id).Publisher, 'Polydor');
  assert.equal(written.get(id).Genre, null, 'an emptied field is stated as empty, not left out');
  assert.equal(written.get(id).Lyrics, 'La la la', 'what the window did not change stays');
  assert.deepEqual(problems, []);
  await close();
});

test('the Sound tab shows what the shared analysis read from the audio', async () => {
  const { page, problems, close } = await open();
  const asked = [];
  await page.route(`${site}/api/recordings/facts**`, (route) => {
    asked.push(new URL(route.request().url()).searchParams.getAll('key'));
    const fact = (field, generation, value, modelled = false) => ({ field, generation, value: JSON.stringify(value), modelled, confidence: 1, agreements: 0 });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        recordingId: 'r1',
        facts: [
          fact('key', 1, { camelot: '8A', confidence: '0.73' }),
          fact('grid', 10, { bpm: '123.9', bpmConfidence: '0.9', beats: '0.5,1', firstDownbeat: '0', downbeatConfidence: '0.6', beatsPerBar: '4' }, true),
          fact('energy', 1, { curve: '0.1', intensity: '0.81' }),
        ],
      }),
    });
  });
  await page.click('.rail button:has-text("Albums")');
  await page.click('button[aria-label="Data table"]');
  await page.waitForSelector('.table .row');
  await page.click('.table .row >> nth=0', { button: 'right' });
  await page.click('text=Edit track…');
  await page.click('[role=tab]:has-text("Sound")');
  await page.waitForSelector('text=READING');

  const shown = await page.locator('[role=dialog]').innerText();
  assert.match(shown, /8A {2}· {2}Am {3}confidence 0\.73/);
  assert.match(shown, /124 BPM {3}confidence 0\.90/);
  assert.match(shown, /4 beats to the bar, first bar line on beat 1/);
  assert.match(shown, /0\.81/);
  assert.match(shown, /Trained model/);
  assert.ok(asked[0].some((key) => key.startsWith('rpm:')), 'the track is asked for by its id');
  assert.deepEqual(problems, []);
  await close();
});

test('the album editor sets the levelling and the series, which travel with the record marks', async () => {
  const { page, problems, close } = await open();
  const said = [];
  await page.route(`${site}/api/cloud/album-mark/**`, (route) => {
    said.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"updatedAt":5}' });
  });
  await page.click('.rail button:has-text("Albums")');
  await page.locator('article, .card, .album').first().click({ button: 'right' });
  await page.click('text=Edit album');
  await page.waitForSelector('text=Apply changes to tracks');
  await page.click('[role=tab]:has-text("Settings")');

  const series = page.locator('[role=dialog] input[aria-label="Series"]');
  assert.equal(await series.isDisabled(), true, 'the series waits behind a yes');
  await page.selectOption('select[aria-label="Levelling"]', 'off');
  await page.selectOption('select[aria-label="Part of a series"]', 'yes');
  await series.fill('Now That\'s What I Call Music');
  await page.fill('[role=dialog] input[aria-label="Volume"]', '43');
  await page.click('button:has-text("Save album")');
  await page.waitForSelector('[role=dialog]', { state: 'detached' });

  const settings = said.filter((call) => call.path.endsWith('/settings'));
  assert.equal(settings.length, 1);
  assert.deepEqual(settings[0].body, { normalize: false, series: "Now That's What I Call Music", seriesVolume: '43' });
  assert.deepEqual(problems, []);
  await close();
});

test('the album editor writes a changed field to every track, and keeps each favourite mark', async () => {
  const { page, pushes, written, problems, close } = await open();
  await page.click('.rail button:has-text("Albums")');
  await page.locator('article, .card, .album').first().click({ button: 'right' });
  await page.click('text=Edit album');
  await page.waitForSelector('text=Apply changes to tracks');
  const album = await box(page, 'Album').inputValue();
  const tracks = FILES.filter((file) => file.album === album);

  await box(page, 'Year').fill('2001');
  await page.click('button:has-text("Save album")');
  await page.waitForSelector('[role=dialog]', { state: 'detached' });

  const items = pushes.flatMap((push) => push.items);
  assert.equal(items.length, tracks.length);
  for (const item of items) {
    assert.equal(item.tags.year, 2001);
    assert.equal(typeof item.tags.favorite, 'boolean', 'the mark goes with the tags, or the store would clear it');
  }
  assert.equal(written.size, tracks.length);
  for (const sidecar of written.values()) assert.equal(sidecar.Year, 2001);
  assert.deepEqual(problems, []);
  await close();
});

test('the mass edit writes only the ticked fields, to every selected track', async () => {
  const { page, pushes, written, problems, close } = await open();
  await page.click('.rail button:has-text("Albums")');
  await page.click('button[aria-label="Data table"]');
  await page.waitForSelector('.table .row');
  await page.click('.table .row >> nth=0');
  await page.click('.table .row >> nth=3', { modifiers: ['Shift'] });
  assert.equal(await page.locator('.table .row.selected').count(), 4);
  await page.click('.table .row >> nth=1', { button: 'right' });
  await page.click('text=Edit selected…');
  await page.waitForSelector('[role=tab]:has-text("Credits")');

  assert.equal(await box(page, 'Genre').isDisabled(), true, 'a box is off until its field is ticked');
  await page.locator('.rows input[type=checkbox][aria-label="Genre"]').check();
  await box(page, 'Genre').fill('Ambient');
  await page.click('button:has-text("Apply to selection")');
  await page.waitForSelector('[role=dialog]', { state: 'detached' });

  const items = pushes.flatMap((push) => push.items);
  assert.equal(items.length, 4);
  for (const item of items) {
    assert.deepEqual(Object.keys(item.tags).sort(), ['favorite', 'favoritedAt', 'genre']);
    assert.equal(item.tags.genre, 'Ambient');
  }
  for (const sidecar of written.values()) assert.equal(sidecar.Publisher, 'Island');
  assert.deepEqual(problems, []);
  await close();
});

test('a record gets a review with its stars, kept in this browser, and the preview shows the Markdown', async () => {
  const { page, problems, close } = await open();
  await page.click('.rail button:has-text("Albums")');
  await page.locator('article, .card, .album', { hasText: 'Kid A' }).first().click({ button: 'right' });
  await page.click('text=Write a review');
  await page.click('[aria-label="4 stars"]');
  await page.fill('textarea', 'A **great** record\n- side one');
  assert.equal(await page.textContent('.preview strong'), 'great');
  await page.click('button:has-text("Save review")');
  await page.waitForSelector('[role=dialog]', { state: 'detached' });

  await page.locator('article, .card, .album', { hasText: 'Kid A' }).first().click({ button: 'right' });
  await page.click('text=Write a review');
  await page.waitForFunction(() => document.querySelector('textarea')?.value === 'A **great** record\n- side one');
  assert.equal(await page.locator('.stars button.on').count(), 4);
  assert.deepEqual(problems, []);
  await close();
});

test('Recognise names a track already in the cloud from its audio, and saves the name', async () => {
  const { page, pushes, problems, close } = await open();
  await page.route(`${site}/api/identify`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'matched', source: 'acoustid', track: { title: 'Found Title', artist: 'Found Artist', score: 0.93 } }) }),
  );
  await page.click('.rail button:has-text("Albums")');
  await page.click('button[aria-label="Data table"]');
  await page.waitForSelector('.table .row');
  await page.click('.table .row >> nth=0', { button: 'right' });
  await page.click('[role=menuitem]:has-text("Recognise")');
  await page.click('button:has-text("Recognise")');
  await page.waitForSelector('text=Found Artist · Found Title', { timeout: 30000 });
  await page.click('[role=dialog] button[aria-label="Cancel"], [role=dialog] button:has-text("Close")');
  await page.waitForSelector('[role=dialog]', { state: 'detached' });
  const item = pushes.flatMap((push) => push.items)[0];
  assert.equal(item.title, 'Found Title');
  assert.equal(item.artist, 'Found Artist');
  assert.deepEqual(problems, []);
  await close();
});
